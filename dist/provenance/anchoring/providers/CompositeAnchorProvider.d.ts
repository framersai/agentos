/**
 * @file CompositeAnchorProvider.ts
 * @description Composes multiple AnchorProviders and publishes to all of them
 * in parallel. Returns results for each provider. The highest proof level
 * among successful results is used as the composite's effective proof level.
 *
 * @module AgentOS/Provenance/Anchoring/Providers
 */
import type { AnchorProvider, AnchorRecord, AnchorProviderResult, ProofLevel } from '../../types.js';
export declare class CompositeAnchorProvider implements AnchorProvider {
    readonly id = "composite";
    readonly name = "Composite Provider";
    private readonly providers;
    constructor(providers: AnchorProvider[]);
    get proofLevel(): ProofLevel;
    publish(anchor: AnchorRecord): Promise<AnchorProviderResult>;
    verify(anchor: AnchorRecord): Promise<boolean>;
    dispose(): Promise<void>;
}
//# sourceMappingURL=CompositeAnchorProvider.d.ts.map