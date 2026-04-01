/**
 * @file CompositeAnchorProvider.ts
 * @description Composes multiple AnchorProviders and publishes to all of them
 * in parallel. Returns results for each provider. The highest proof level
 * among successful results is used as the composite's effective proof level.
 *
 * @module AgentOS/Provenance/Anchoring/Providers
 */
const PROOF_LEVEL_ORDER = [
    'verifiable',
    'externally-archived',
    'publicly-auditable',
    'publicly-timestamped',
];
export class CompositeAnchorProvider {
    constructor(providers) {
        this.id = 'composite';
        this.name = 'Composite Provider';
        this.providers = providers;
    }
    get proofLevel() {
        let maxIndex = 0;
        for (const p of this.providers) {
            const idx = PROOF_LEVEL_ORDER.indexOf(p.proofLevel);
            if (idx > maxIndex)
                maxIndex = idx;
        }
        return PROOF_LEVEL_ORDER[maxIndex];
    }
    async publish(anchor) {
        const results = await Promise.allSettled(this.providers.map(p => p.publish(anchor)));
        const providerResults = results.map((r, i) => {
            if (r.status === 'fulfilled')
                return r.value;
            return {
                providerId: this.providers[i].id,
                success: false,
                error: r.reason?.message ?? String(r.reason),
            };
        });
        const firstSuccess = providerResults.find(r => r.success && r.externalRef);
        return {
            providerId: this.id,
            success: providerResults.some(r => r.success),
            externalRef: firstSuccess?.externalRef,
            metadata: { providerResults },
            publishedAt: new Date().toISOString(),
        };
    }
    async verify(anchor) {
        const results = await Promise.allSettled(this.providers
            .filter(p => p.verify)
            .map(p => p.verify(anchor)));
        return results.every(r => r.status === 'fulfilled' && r.value === true);
    }
    async dispose() {
        await Promise.allSettled(this.providers
            .filter(p => p.dispose)
            .map(p => p.dispose()));
    }
}
//# sourceMappingURL=CompositeAnchorProvider.js.map