/**
 * @file PolicyProfiles.ts
 * @description Preset policy profiles for common provenance configurations.
 * Provides mutableDev(), revisionedVerified(), and sealedAutonomous() presets.
 *
 * @module AgentOS/Provenance/Config
 */
import type { ProvenanceSystemConfig } from '../types.js';
/**
 * Policy profiles for quick configuration.
 *
 * @example
 * ```typescript
 * import { profiles } from '@framers/agentos/provenance';
 *
 * // For development:
 * const config = profiles.mutableDev();
 *
 * // For production with audit trail:
 * const config = profiles.revisionedVerified();
 *
 * // For autonomous agents:
 * const config = profiles.sealedAutonomous();
 * ```
 */
export declare const profiles: {
    /**
     * Mutable (development) mode.
     * No enforcement, no signing, no restrictions.
     * Standard app semantics with optional ledger.
     */
    mutableDev(): ProvenanceSystemConfig;
    /**
     * Revisioned (verifiable) mode.
     * Edits become revisions. Deletes become tombstones.
     * Full signed event ledger with periodic anchoring.
     * Humans can still interact, but all changes are tracked.
     */
    revisionedVerified(): ProvenanceSystemConfig;
    /**
     * Sealed (autonomous) mode.
     * Append-only storage. No human prompting after genesis.
     * Signed event ledger with frequent anchoring.
     * Required for "Verified Autonomous" badge.
     */
    sealedAutonomous(): ProvenanceSystemConfig;
    /**
     * Sealed mode with Rekor transparency log anchoring.
     * Suitable for publicly auditable autonomous agents.
     *
     * Requires `@framers/agentos-ext-anchor-providers` extension
     * with `registerExtensionProviders()` called at startup.
     */
    sealedAuditable(rekorEndpoint?: string): ProvenanceSystemConfig;
    /**
     * Create a custom profile by merging overrides onto a base.
     */
    custom(base: ProvenanceSystemConfig, overrides: Partial<ProvenanceSystemConfig>): ProvenanceSystemConfig;
};
//# sourceMappingURL=PolicyProfiles.d.ts.map