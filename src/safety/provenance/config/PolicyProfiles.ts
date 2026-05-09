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
export const profiles = {
  /**
   * Mutable (development) mode.
   * No enforcement, no signing, no restrictions.
   * Standard app semantics with optional ledger.
   */
  mutableDev(): ProvenanceSystemConfig {
    return {
      storagePolicy: {
        mode: 'mutable',
      },
      provenance: {
        enabled: false,
        signatureMode: 'anchor-only',
        hashAlgorithm: 'sha256',
        keySource: { type: 'generate' },
      },
      autonomy: {
        allowHumanPrompting: true,
        allowConfigEdits: true,
        allowToolChanges: true,
      },
      anchorIntervalMs: 0,
      anchorBatchSize: 0,
    };
  },

  /**
   * Revisioned (verifiable) mode.
   * Edits become revisions. Deletes become tombstones.
   * Full signed event ledger with periodic anchoring.
   * Humans can still interact, but all changes are tracked.
   */
  revisionedVerified(): ProvenanceSystemConfig {
    return {
      storagePolicy: {
        mode: 'revisioned',
      },
      provenance: {
        enabled: true,
        signatureMode: 'every-event',
        hashAlgorithm: 'sha256',
        keySource: { type: 'generate' },
      },
      autonomy: {
        allowHumanPrompting: true,
        allowConfigEdits: true,
        allowToolChanges: true,
      },
      anchorIntervalMs: 300_000, // 5 minutes
      anchorBatchSize: 100,
    };
  },

  /**
   * Sealed (autonomous) mode.
   * Append-only storage. No human prompting after genesis.
   * Signed event ledger with frequent anchoring.
   * Required for "Verified Autonomous" badge.
   */
  sealedAutonomous(): ProvenanceSystemConfig {
    return {
      storagePolicy: {
        mode: 'sealed',
        protectedTables: [
          'conversations',
          'conversation_messages',
          'messages',
        ],
      },
      provenance: {
        enabled: true,
        signatureMode: 'every-event',
        hashAlgorithm: 'sha256',
        keySource: { type: 'generate' },
      },
      autonomy: {
        allowHumanPrompting: false,
        allowConfigEdits: false,
        allowToolChanges: false,
        allowedHumanActions: ['pause', 'stop', 'approve_gated_action'],
      },
      anchorIntervalMs: 60_000, // 1 minute
      anchorBatchSize: 50,
    };
  },

  /**
   * Sealed mode with Rekor transparency log anchoring.
   * Suitable for publicly auditable autonomous agents.
   *
   * Requires `@framers/agentos-ext-anchor-providers` extension
   * with `registerExtensionProviders()` called at startup.
   */
  sealedAuditable(rekorEndpoint?: string): ProvenanceSystemConfig {
    return profiles.custom(profiles.sealedAutonomous(), {
      provenance: {
        enabled: true,
        signatureMode: 'every-event',
        hashAlgorithm: 'sha256',
        keySource: { type: 'generate' },
        anchorTarget: {
          type: 'rekor',
          endpoint: rekorEndpoint ?? 'https://rekor.sigstore.dev',
          options: { serverUrl: rekorEndpoint ?? 'https://rekor.sigstore.dev' },
        },
      },
    });
  },

  /**
   * Create a custom profile by merging overrides onto a base.
   */
  custom(
    base: ProvenanceSystemConfig,
    overrides: Partial<ProvenanceSystemConfig>,
  ): ProvenanceSystemConfig {
    return {
      ...base,
      ...overrides,
      storagePolicy: { ...base.storagePolicy, ...overrides.storagePolicy },
      provenance: { ...base.provenance, ...overrides.provenance },
      autonomy: { ...base.autonomy, ...overrides.autonomy },
    };
  },
};
