/**
 * @module voice-pipeline/providers/BatchTTSFallback
 *
 * Wraps multiple {@link IBatchTTS} providers in priority order.
 * Tries each in sequence; returns the first successful result.
 * Throws an aggregate error if all providers fail.
 */
export class BatchTTSFallback {
    constructor(providers) {
        this.providerId = 'fallback';
        this.providers = providers;
    }
    async synthesize(text, config) {
        if (this.providers.length === 0) {
            throw new Error('No TTS providers configured');
        }
        const errors = [];
        for (const provider of this.providers) {
            try {
                return await provider.synthesize(text, config);
            }
            catch (err) {
                errors.push({
                    provider: provider.providerId,
                    error: err instanceof Error ? err : new Error(String(err)),
                });
            }
        }
        const summary = errors.map((e) => `${e.provider}: ${e.error.message}`).join('; ');
        throw new Error(`All TTS providers failed: ${summary}`);
    }
}
//# sourceMappingURL=BatchTTSFallback.js.map