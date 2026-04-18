/**
 * @module voice-pipeline/VoicePipelineError
 *
 * Structured error class for voice pipeline failures. Carries enough shape
 * for chains and circuit breakers to classify and react without stringly
 * matching error.message.
 */
export class VoicePipelineError extends Error {
    constructor(init) {
        super(init.message);
        this.name = 'VoicePipelineError';
        this.kind = init.kind;
        this.provider = init.provider;
        this.errorClass = init.errorClass;
        this.retryable = init.retryable;
        this.cause = init.cause;
    }
    /**
     * Best-effort classification of an arbitrary error into a voice-pipeline
     * error with a well-known errorClass. Preserves the original error as
     * `cause` so upstream inspection can still recover provider-specific
     * detail.
     */
    static classifyError(err, meta) {
        const raw = err instanceof Error ? err : new Error(String(err));
        const msg = raw.message ?? '';
        const code = err?.code ?? '';
        let errorClass = 'unknown';
        let retryable = true;
        if (/\b401\b|unauthori[sz]ed|invalid api key|forbidden|\b403\b/i.test(msg)) {
            errorClass = 'auth';
            retryable = false;
        }
        else if (/\b429\b|rate.?limit|too many/i.test(msg)) {
            errorClass = 'quota';
            retryable = true;
        }
        else if (/\b5\d\d\b|internal server|bad gateway|gateway timeout|service unavailable/i.test(msg)) {
            errorClass = 'service';
            retryable = true;
        }
        else if (code === 'ECONNRESET' ||
            code === 'ETIMEDOUT' ||
            code === 'ENOTFOUND' ||
            /econnreset|etimedout|enotfound|socket hang up|network/i.test(msg)) {
            errorClass = 'network';
            retryable = true;
        }
        return new VoicePipelineError({
            kind: meta.kind,
            provider: meta.provider,
            errorClass,
            message: msg || 'unknown voice pipeline error',
            cause: err,
            retryable,
        });
    }
}
/**
 * Aggregate thrown by `StreamingSTTChain` / `StreamingTTSChain` when every
 * candidate provider fails. Carries the per-provider error list so callers
 * can display a breakdown rather than a single confusing message.
 */
export class AggregateVoiceError extends Error {
    constructor(attempts) {
        const summary = attempts
            .map((a) => `${a.provider}: ${a.errorClass} \u2014 ${a.message}`)
            .join('; ');
        super(`All ${attempts.length} providers failed \u2014 ${summary}`);
        this.name = 'AggregateVoiceError';
        this.attempts = attempts;
    }
}
//# sourceMappingURL=VoicePipelineError.js.map