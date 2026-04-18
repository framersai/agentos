/**
 * @module voice-pipeline/providers/StreamingSTTChain
 *
 * Priority-ordered fallback wrapper around multiple `IStreamingSTT`
 * providers. On `startSession()` the chain tries providers in priority
 * order; the first one whose `startSession()` resolves wins.
 * Init-failure classification records to the circuit breaker so future
 * sessions skip recently-tripped providers without the retry-latency
 * penalty.
 *
 * This file implements Layer 2 of the resilience plan (init-time
 * fallback). Layer 3 (mid-utterance failover via ring buffer) is added
 * in a later task and plugs into the `wrapSession` seam exposed here.
 */
import { EventEmitter } from 'node:events';
import { VoicePipelineError, AggregateVoiceError, } from '../VoicePipelineError.js';
import { AudioRingBuffer } from '../AudioRingBuffer.js';
import { TranscriptDedupe } from '../TranscriptDedupe.js';
export class StreamingSTTChain {
    constructor(providers, opts = {}) {
        this.providerId = 'chain';
        this.isStreaming = false;
        if (providers.length === 0) {
            throw new Error('StreamingSTTChain requires at least one provider');
        }
        this._providers = [...providers].sort((a, b) => a.priority - b.priority);
        this.opts = opts;
    }
    /** Providers in priority order (primary first). Exposed for
     *  introspection by host apps and tests. */
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
                kind: 'stt',
                checkedProviders: this._providers.map((p) => p.providerId),
            });
            throw new Error('No STT providers available (all tripped or filtered)');
        }
        const attempts = [];
        for (let i = 0; i < candidates.length; i++) {
            const provider = candidates[i];
            try {
                const session = await provider.startSession(config);
                this.activeProviderId = provider.providerId;
                const evt = {
                    kind: 'stt',
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
                    kind: 'stt',
                    provider: provider.providerId,
                });
                attempts.push(classified);
                const failEvt = {
                    kind: 'stt',
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
            kind: 'stt',
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
     * Wraps the session returned by a healthy provider. In init-time-only
     * mode (enableMidUtteranceFailover=false) this is a pass-through. In
     * failover mode the session is replaced with a facade that tees audio
     * into a ring buffer, dedupes transcripts across providers, and on
     * session error re-routes to the next candidate.
     */
    wrapSession(initial, initialProvider, candidates, config) {
        if (!this.opts.enableMidUtteranceFailover)
            return initial;
        const ring = new AudioRingBuffer({
            capacityMs: this.opts.ringBufferCapacityMs ?? 3000,
            sampleRate: 16000,
        });
        const dedupe = new TranscriptDedupe();
        const minReplayMs = this.opts.minReplayMs ?? 400;
        const facade = new EventEmitter();
        let currentSession = initial;
        let currentProvider = initialProvider;
        let remaining = [...candidates];
        let isFailingOver = false;
        const attach = (session, providerId) => {
            session.on('transcript', (evt) => {
                const r = dedupe.evaluate({
                    provider: providerId,
                    text: evt.text,
                    audioStartMs: evt.audioStartMs ?? 0,
                    audioEndMs: evt.audioEndMs ?? 0,
                    isFinal: evt.isFinal,
                });
                if (r.isDuplicate)
                    return;
                facade.emit('transcript', evt);
            });
            for (const passthrough of ['vad', 'speech_start', 'speech_end']) {
                session.on(passthrough, (...args) => {
                    facade.emit(passthrough, ...args);
                });
            }
            session.on('error', (err) => {
                void tryFailover(err);
            });
            session.on('close', () => {
                // Natural close on the active session is a failover trigger so the
                // user doesn't silently lose voice mid-turn. If the chain was asked
                // to close() externally, isFailingOver stays false and the close
                // propagates.
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
            const classified = VoicePipelineError.classifyError(err ?? new Error('session ended'), { kind: 'stt', provider: currentProvider.providerId });
            this.opts.breaker?.recordFailure(currentProvider.providerId, classified.errorClass);
            const bufferedFrames = ring.snapshot();
            const bufferedMs = ring.durationMs();
            for (const backup of remaining) {
                if (this.opts.breaker &&
                    !this.opts.breaker.isAvailable(backup.providerId)) {
                    continue;
                }
                try {
                    const session = await backup.startSession(config);
                    attach(session, backup.providerId);
                    if (bufferedMs >= minReplayMs) {
                        for (const f of bufferedFrames) {
                            try {
                                await session.pushAudio(f);
                            }
                            catch {
                                /* tolerate frame-level push failures during replay */
                            }
                        }
                    }
                    currentSession = session;
                    currentProvider = backup;
                    remaining = remaining.filter((c) => c !== backup);
                    this.activeProviderId = backup.providerId;
                    const lostMs = Date.now() - startedAt;
                    const evt = {
                        kind: 'stt',
                        from: initialProvider.providerId,
                        to: backup.providerId,
                        reason: classified.errorClass,
                        lostMs,
                    };
                    this.opts.onProviderFailover?.(evt);
                    this.emitMetric({ type: 'provider_failover', ...evt });
                    isFailingOver = false;
                    return;
                }
                catch (backupErr) {
                    const backClass = VoicePipelineError.classifyError(backupErr, {
                        kind: 'stt',
                        provider: backup.providerId,
                    });
                    this.opts.breaker?.recordFailure(backup.providerId, backClass.errorClass);
                }
            }
            // All backups exhausted — propagate to the facade consumer.
            facade.emit('error', new AggregateVoiceError([classified]));
            isFailingOver = false;
        };
        attach(initial, initialProvider.providerId);
        // The returned object must conform to StreamingSTTSession (EventEmitter
        // with pushAudio + close). We build that explicitly so TS sees the
        // right shape.
        const wrapped = Object.assign(facade, {
            providerId: 'chain',
            pushAudio: async (frame) => {
                ring.push(frame);
                try {
                    await currentSession.pushAudio(frame);
                }
                catch (pushErr) {
                    void tryFailover(pushErr);
                }
            },
            close: async () => {
                await currentSession.close();
            },
        });
        return wrapped;
    }
    emitMetric(event) {
        this.opts.metrics?.emit(event);
    }
}
//# sourceMappingURL=StreamingSTTChain.js.map