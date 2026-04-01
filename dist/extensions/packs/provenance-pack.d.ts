/**
 * @file provenance-pack.ts
 * @description ExtensionPack that wires up the provenance system.
 * Generates/imports Ed25519 keypair, creates schema tables,
 * creates and registers ProvenanceStorageHooks, starts AnchorManager,
 * and appends a genesis event for sealed mode.
 *
 * @module AgentOS/Extensions/Packs
 */
import type { ExtensionPack } from '../manifest.js';
import type { ProvenanceSystemConfig } from '../../provenance/types.js';
import { AgentKeyManager } from '../../provenance/crypto/AgentKeyManager.js';
import { SignedEventLedger } from '../../provenance/ledger/SignedEventLedger.js';
import { RevisionManager } from '../../provenance/enforcement/RevisionManager.js';
import { TombstoneManager } from '../../provenance/enforcement/TombstoneManager.js';
import { AutonomyGuard } from '../../provenance/enforcement/AutonomyGuard.js';
import { AnchorManager } from '../../provenance/anchoring/AnchorManager.js';
import { createProvenanceHooks } from '../../provenance/enforcement/ProvenanceStorageHooks.js';
interface ProvenanceStorageAdapter {
    run(statement: string, parameters?: unknown[]): Promise<{
        changes: number;
    }>;
    all<T = unknown>(statement: string, parameters?: unknown[]): Promise<T[]>;
    get<T = unknown>(statement: string, parameters?: unknown[]): Promise<T | null>;
    exec?(script: string): Promise<void>;
}
/**
 * Result of activating the provenance pack.
 * Provides access to the initialized provenance components.
 */
export interface ProvenancePackResult {
    keyManager: AgentKeyManager;
    ledger: SignedEventLedger;
    revisionManager: RevisionManager;
    tombstoneManager: TombstoneManager;
    autonomyGuard: AutonomyGuard;
    anchorManager: AnchorManager;
    hooks: ReturnType<typeof createProvenanceHooks>;
    genesisEventId?: string;
}
/**
 * Create an ExtensionPack that initializes the provenance system.
 *
 * Usage:
 * ```ts
 * import { profiles } from '../../provenance';
 * import { createProvenancePack } from '../../extensions/packs/provenance-pack';
 *
 * const pack = createProvenancePack(
 *   profiles.sealedAutonomous(),
 *   storageAdapter,
 *   'agent-001',
 * );
 * ```
 *
 * @param config - ProvenanceSystemConfig (use profiles for presets).
 * @param storageAdapter - A sql-storage-adapter instance.
 * @param agentId - The agent's unique identifier.
 * @param tablePrefix - Optional prefix for provenance tables.
 * @returns ExtensionPack with a provenance descriptor.
 */
export declare function createProvenancePack(config: ProvenanceSystemConfig, storageAdapter: ProvenanceStorageAdapter, agentId: string, tablePrefix?: string): ExtensionPack & {
    getResult(): ProvenancePackResult | null;
};
export {};
//# sourceMappingURL=provenance-pack.d.ts.map