/**
 * @file NoneProvider.ts
 * @description No-op anchor provider for development mode.
 * Does not publish anchors externally. Default when no provider is configured.
 *
 * @module AgentOS/Provenance/Anchoring/Providers
 */
import type { AnchorProvider, AnchorRecord, AnchorProviderResult, ProofLevel } from '../../types.js';
export declare class NoneProvider implements AnchorProvider {
    readonly id = "none";
    readonly name = "None (Local Only)";
    readonly proofLevel: ProofLevel;
    publish(_anchor: AnchorRecord): Promise<AnchorProviderResult>;
}
//# sourceMappingURL=NoneProvider.d.ts.map