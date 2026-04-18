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
import { VoicePipelineError, AggregateVoiceError, } from '../VoicePipelineError.js';
export class StreamingTTSChain {
    constructor(providers, opts = {}) {
        this.providerId = 'chain';
        if (providers.length === 0) {
            throw new Error('StreamingTTSChain requires at least one provider');
        }
        this._providers = [...providers].sort((a, b) => a.priority - b.priority);
        this.opts = opts;
    }
    get providers() {
        return this._providers;
    }
    get currentProviderId() {
        return this.activeProviderId;
    }
    async startSession(config) {
        const candidates = this.filterCandidates();
        if (candidates.length === 0) {
            this.emitMetric({
                type: 'provider_unavailable',
                kind: 'tts',
                checkedProviders: this._providers.map((p) => p.providerId),
            });
            throw new Error('No TTS providers available (all tripped or filtered)');
        }
        const attempts = [];
        for (let i = 0; i < candidates.length; i++) {
            const provider = candidates[i];
            try {
                const session = await provider.startSession(config);
                this.activeProviderId = provider.providerId;
                const evt = {
                    kind: 'tts',
                    providerId: provider.providerId,
                    attempt: i + 1,
                };
                this.opts.onProviderSelected?.(evt);
                this.emitMetric({ type: 'provider_selected', ...evt });
                this.opts.breaker?.recordSuccess(provider.providerId);
                return this.wrapSession(session, provider, candidates.slice(i + 1), config);
            }
            catch (err) {
                const classified = VoicePipelineError.classifyError(err, {
                    kind: 'tts',
                    provider: provider.providerId,
                });
                attempts.push(classified);
                const failEvt = {
                    kind: 'tts',
                    providerId: provider.providerId,
                    errorClass: classified.errorClass,
                    message: classified.message,
                };
                this.opts.onProviderFailed?.(failEvt);
                this.emitMetric({ type: 'provider_failed', ...failEvt });
                this.opts.breaker?.recordFailure(provider.providerId, classified.errorClass);
            }
        }
        this.emitMetric({
            type: 'provider_unavailable',
            kind: 'tts',
            checkedProviders: candidates.map((p) => p.providerId),
        });
        throw new AggregateVoiceError(attempts);
    }
    filterCandidates() {
        if (!this.opts.breaker)
            return this._providers;
        return this._providers.filter((p) => this.opts.breaker.isAvailable(p.providerId));
    }
    /**
     * Wraps a session for mid-synthesis failover. The facade tees pushTokens
     * calls into an accumulator and, when the primary emits 'error',
     * opens a new session on the next backup and replays the accumulator
     * before returning control.
     */
    wrapSession(initial, initialProvider, candidates, config) {
        if (!this.opts.enableMidSynthesisFailover)
            return initial;
        const facade = new EventEmitter();
        const tokensSinceFlush = [];
        let currentSession = initial;
        let currentProvider = initialProvider;
        let remaining = [...candidates];
        let isFailingOver = false;
        const attach = (session, _providerId) => {
            session.on('audio', (chunk) => {
                facade.emit('audio', chunk);
            });
            session.on('flush_complete', () => {
                tokensSinceFlush.length = 0;
                facade.emit('flush_complete');
            });
            session.on('error', (err) => {
                void tryFailover(err);
            });
            session.on('close', () => {
                if (!isFailingOver && currentSession === session) {
                    void tryFailover(undefined);
                }
            });
        };
        const tryFailover = async (err) => {
            if (isFailingOver)
                return;
            isFailingOver = true;
            const startedAt = Date.now();
            const classified = VoicePipelineError.classifyError(err ?? new Error('session ended'), { kind: 'tts', provider: currentProvider.providerId });
            this.opts.breaker?.recordFailure(currentProvider.providerId, classified.errorClass);
            for (const backup of remaining) {
                if (this.opts.breaker &&
                    !this.opts.breaker.isAvailable(backup.providerId)) {
                    continue;
                }
                try {
                    const session = await backup.startSession(config);
                    attach(session, backup.providerId);
                    // Replay everything accumulated since the last successful flush.
                    for (const t of tokensSinceFlush) {
                        try {
                            session.pushTokens(t);
                        }
                        catch {
                            /* tolerate per-token failures during replay */
                        }
                    }
                    currentSession = session;
                    currentProvider = backup;
                    remaining = remaining.filter((c) => c !== backup);
                    this.activeProviderId = backup.providerId;
                    const evt = {
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
                }
                catch (backupErr) {
                    const backClass = VoicePipelineError.classifyError(backupErr, {
                        kind: 'tts',
                        provider: backup.providerId,
                    });
                    this.opts.breaker?.recordFailure(backup.providerId, backClass.errorClass);
                }
            }
            facade.emit('error', new AggregateVoiceError([classified]));
            isFailingOver = false;
        };
        attach(initial, initialProvider.providerId);
        const wrapped = Object.assign(facade, {
            providerId: 'chain',
            pushTokens: (tokens) => {
                tokensSinceFlush.push(tokens);
                try {
                    currentSession.pushTokens(tokens);
                }
                catch (err) {
                    void tryFailover(err);
                }
            },
            flush: async () => {
                try {
                    await currentSession.flush();
                }
                catch (err) {
                    void tryFailover(err);
                }
            },
            cancel: () => {
                tokensSinceFlush.length = 0;
                try {
                    currentSession.cancel();
                }
                catch {
                    /* best-effort */
                }
            },
            close: () => {
                try {
                    currentSession.close();
                }
                catch {
                    /* best-effort */
                }
            },
        });
        return wrapped;
    }
    emitMetric(event) {
        this.opts.metrics?.emit(event);
    }
}
//# sourceMappingURL=StreamingTTSChain.js.map