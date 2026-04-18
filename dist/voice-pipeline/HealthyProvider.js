/**
 * @module voice-pipeline/HealthyProvider
 *
 * Provider-health trait adopted by every STT/TTS implementation so chains
 * can prune, route, and circuit-break without peering into each provider's
 * private state.
 */
export function defaultCapabilities(overrides = {}) {
    return {
        languages: ['*'],
        streaming: true,
        maxConcurrent: Infinity,
        costTier: 'standard',
        latencyClass: 'realtime',
        ...overrides,
    };
}
export function supportsLanguage(caps, lang) {
    if (caps.languages.includes('*'))
        return true;
    const normalized = lang.toLowerCase();
    return caps.languages.some((supported) => {
        const s = supported.toLowerCase();
        return (s === normalized ||
            normalized.startsWith(s + '-') ||
            s.startsWith(normalized + '-'));
    });
}
//# sourceMappingURL=HealthyProvider.js.map