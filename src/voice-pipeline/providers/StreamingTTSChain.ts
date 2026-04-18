/**
 * @module voice-pipeline/providers/StreamingTTSChain
 *
 * Priority-ordered fallback wrapper around multiple `IStreamingTTS`
 * providers. Mirrors `StreamingSTTChain` semantics for outbound synthesis.
 *
 * Mid-synthesis failover is simpler than mid-utterance STT failover
 * because TTS is one-way (text in, audio out). The chain accumulates
 * tokens pushed to the primary and, on primary failure, re-sends them
 * to the backup. Clients may use the first backup audio chunk's
 * `fadeInMs` hint to crossfade between timbres.
 */

import { EventEmitter } from 'node:events';
import type {
  IStreamingTTS,
  StreamingTTSSession,
  StreamingTTSConfig,
  EncodedAudioChunk,
} from '../types.js';
import type { HealthyProvider } from '../HealthyProvider.js';
import {
  VoicePipelineError,
  AggregateVoiceError,
  type HealthErrorClass,
} from '../VoicePipelineError.js';
import type { CircuitBreaker } from '../CircuitBreaker.js';
import type {
  VoiceMetricsReporter,
  VoiceMetricEvent,
} from '../VoiceMetricsReporter.js';

export interface TTSProviderSelectedEvent {
  kind: 'tts';
  providerId: string;
  attempt: number;
}

export interface TTSProviderFailedEvent {
  kind: 'tts';
  providerId: string;
  errorClass: HealthErrorClass;
  message: string;
}

export interface TTSProviderFailoverEvent {
  kind: 'tts';
  from: string;
  to: string;
  reason: HealthErrorClass;
  lostMs: number;
}

export interface StreamingTTSChainOptions {
  breaker?: CircuitBreaker;
  metrics?: VoiceMetricsReporter;
  onProviderSelected?: (event: TTSProviderSelectedEvent) => void;
  onProviderFailed?: (event: TTSProviderFailedEvent) => void;
  onProviderFailover?: (event: TTSProviderFailoverEvent) => void;
  /** When true, the chain tracks accumulated tokens and re-submits them
   *  to the next backup if the primary errors mid-synthesis. */
  enableMidSynthesisFailover?: boolean;
}

type TTSProvider = IStreamingTTS & HealthyProvider;

export class StreamingTTSChain implements IStreamingTTS {
  readonly providerId = 'chain';

  private readonly _providers: TTSProvider[];
  private readonly opts: StreamingTTSChainOptions;
  private activeProviderId?: string;

  constructor(providers: TTSProvider[], opts: StreamingTTSChainOptions = {}) {
    if (providers.length === 0) {
      throw new Error('StreamingTTSChain requires at least one provider');
    }
    this._providers = [...providers].sort((a, b) => a.priority - b.priority);
    this.opts = opts;
  }

  get providers(): readonly TTSProvider[] {
    return this._providers;
  }

  get currentProviderId(): string | undefined {
    return this.activeProviderId;
  }

  async startSession(config?: StreamingTTSConfig): Promise<StreamingTTSSession> {
    const candidates = this.filterCandidates();
    if (candidates.length === 0) {
      this.emitMetric({
        type: 'provider_unavailable',
        kind: 'tts',
        checkedProviders: this._providers.map((p) => p.providerId),
      });
      throw new Error('No TTS providers available (all tripped or filtered)');
    }

    const attempts: VoicePipelineError[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const provider = candidates[i];
      try {
        const session = await provider.startSession(config);
        this.activeProviderId = provider.providerId;
        const evt: TTSProviderSelectedEvent = {
          kind: 'tts',
          providerId: provider.providerId,
          attempt: i + 1,
        };
        this.opts.onProviderSelected?.(evt);
        this.emitMetric({ type: 'provider_selected', ...evt });
        this.opts.breaker?.recordSuccess(provider.providerId);
        return this.wrapSession(
          session,
          provider,
          candidates.slice(i + 1),
          config
        );
      } catch (err) {
        const classified = VoicePipelineError.classifyError(err, {
          kind: 'tts',
          provider: provider.providerId,
        });
        attempts.push(classified);
        const failEvt: TTSProviderFailedEvent = {
          kind: 'tts',
          providerId: provider.providerId,
          errorClass: classified.errorClass,
          message: classified.message,
        };
        this.opts.onProviderFailed?.(failEvt);
        this.emitMetric({ type: 'provider_failed', ...failEvt });
        this.opts.breaker?.recordFailure(
          provider.providerId,
          classified.errorClass
        );
      }
    }

    this.emitMetric({
      type: 'provider_unavailable',
      kind: 'tts',
      checkedProviders: candidates.map((p) => p.providerId),
    });
    throw new AggregateVoiceError(attempts);
  }

  private filterCandidates(): TTSProvider[] {
    if (!this.opts.breaker) return this._providers;
    return this._providers.filter((p) =>
      this.opts.breaker!.isAvailable(p.providerId)
    );
  }

  /**
   * Wraps a session for mid-synthesis failover. The facade tees pushTokens
   * calls into an accumulator and, when the primary emits 'error',
   * opens a new session on the next backup and replays the accumulator
   * before returning control.
   */
  private wrapSession(
    initial: StreamingTTSSession,
    initialProvider: TTSProvider,
    candidates: TTSProvider[],
    config?: StreamingTTSConfig
  ): StreamingTTSSession {
    if (!this.opts.enableMidSynthesisFailover) return initial;

    const facade = new EventEmitter();
    const tokensSinceFlush: string[] = [];
    let currentSession = initial;
    let currentProvider = initialProvider;
    let remaining = [...candidates];
    let isFailingOver = false;

    const attach = (session: StreamingTTSSession, _providerId: string) => {
      session.on('audio', (chunk: EncodedAudioChunk) => {
        facade.emit('audio', chunk);
      });
      session.on('flush_complete', () => {
        tokensSinceFlush.length = 0;
        facade.emit('flush_complete');
      });
      session.on('error', (err: Error) => {
        void tryFailover(err);
      });
      session.on('close', () => {
        if (!isFailingOver && currentSession === session) {
          void tryFailover(undefined);
        }
      });
    };

    const tryFailover = async (err?: Error) => {
      if (isFailingOver) return;
      isFailingOver = true;
      const startedAt = Date.now();
      const classified = VoicePipelineError.classifyError(
        err ?? new Error('session ended'),
        { kind: 'tts', provider: currentProvider.providerId }
      );
      this.opts.breaker?.recordFailure(
        currentProvider.providerId,
        classified.errorClass
      );

      for (const backup of remaining) {
        if (
          this.opts.breaker &&
          !this.opts.breaker.isAvailable(backup.providerId)
        ) {
          continue;
        }
        try {
          const session = await backup.startSession(config);
          attach(session, backup.providerId);
          // Replay everything accumulated since the last successful flush.
          for (const t of tokensSinceFlush) {
            try {
              session.pushTokens(t);
            } catch {
              /* tolerate per-token failures during replay */
            }
          }
          currentSession = session;
          currentProvider = backup;
          remaining = remaining.filter((c) => c !== backup);
          this.activeProviderId = backup.providerId;
          const evt: TTSProviderFailoverEvent = {
            kind: 'tts',
            from: initialProvider.providerId,
            to: backup.providerId,
            reason: classified.errorClass,
            lostMs: Date.now() - startedAt,
          };
          this.opts.onProviderFailover?.(evt);
          this.emitMetric({ type: 'provider_failover', ...evt });
          isFailingOver = false;
          return;
        } catch (backupErr) {
          const backClass = VoicePipelineError.classifyError(backupErr, {
            kind: 'tts',
            provider: backup.providerId,
          });
          this.opts.breaker?.recordFailure(
            backup.providerId,
            backClass.errorClass
          );
        }
      }

      facade.emit('error', new AggregateVoiceError([classified]));
      isFailingOver = false;
    };

    attach(initial, initialProvider.providerId);

    const wrapped = Object.assign(facade, {
      providerId: 'chain',
      pushTokens: (tokens: string) => {
        tokensSinceFlush.push(tokens);
        try {
          currentSession.pushTokens(tokens);
        } catch (err) {
          void tryFailover(err as Error);
        }
      },
      flush: async () => {
        try {
          await currentSession.flush();
        } catch (err) {
          void tryFailover(err as Error);
        }
      },
      cancel: () => {
        tokensSinceFlush.length = 0;
        try {
          currentSession.cancel();
        } catch {
          /* best-effort */
        }
      },
      close: () => {
        try {
          currentSession.close();
        } catch {
          /* best-effort */
        }
      },
    }) as unknown as StreamingTTSSession;

    return wrapped;
  }

  private emitMetric(event: VoiceMetricEvent): void {
    this.opts.metrics?.emit(event);
  }
}
