/**
 * @file NoneProvider.ts
 * @description No-op anchor provider for development mode.
 * Does not publish anchors externally. Default when no provider is configured.
 *
 * @module AgentOS/Provenance/Anchoring/Providers
 */
export class NoneProvider {
    constructor() {
        this.id = 'none';
        this.name = 'None (Local Only)';
        this.proofLevel = 'verifiable';
    }
    async publish(_anchor) {
        return {
            providerId: this.id,
            success: true,
        };
    }
}
//# sourceMappingURL=NoneProvider.js.map