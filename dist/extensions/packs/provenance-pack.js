/**
 * @file provenance-pack.ts
 * @description ExtensionPack that wires up the provenance system.
 * Generates/imports Ed25519 keypair, creates schema tables,
 * creates and registers ProvenanceStorageHooks, starts AnchorManager,
 * and appends a genesis event for sealed mode.
 *
 * @module AgentOS/Extensions/Packs
 */
import { EXTENSION_KIND_PROVENANCE } from '../types.js';
import { AgentKeyManager } from '../../provenance/crypto/AgentKeyManager.js';
import { SignedEventLedger } from '../../provenance/ledger/SignedEventLedger.js';
import { RevisionManager } from '../../provenance/enforcement/RevisionManager.js';
import { TombstoneManager } from '../../provenance/enforcement/TombstoneManager.js';
import { AutonomyGuard } from '../../provenance/enforcement/AutonomyGuard.js';
import { AnchorManager } from '../../provenance/anchoring/AnchorManager.js';
import { createAnchorProvider } from '../../provenance/anchoring/providers/createAnchorProvider.js';
import { createProvenanceHooks } from '../../provenance/enforcement/ProvenanceStorageHooks.js';
import { getProvenanceSchema } from '../../provenance/schema/provenance-schema.js';
// =============================================================================
// createProvenancePack
// =============================================================================
/**
 * Create an ExtensionPack that initializes the provenance system.
 *
 * Usage:
 * ```ts
 * import { profiles } from '../../provenance/index.js';
 * import { createProvenancePack } from '../../extensions/packs/provenance-pack.js';
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
export function createProvenancePack(config, storageAdapter, agentId, tablePrefix = '') {
    let result = null;
    const payload = {
        config,
        result,
    };
    const pack = {
        name: 'provenance',
        version: '1.0.0',
        descriptors: [
            {
                id: 'provenance-system',
                kind: EXTENSION_KIND_PROVENANCE,
                enableByDefault: true,
                priority: 0,
                metadata: {
                    mode: config.storagePolicy.mode,
                    signingEnabled: config.provenance.enabled,
                },
                payload,
                source: {
                    sourceName: '@framers/agentos',
                    sourceVersion: '1.2.0',
                    identifier: 'provenance-pack',
                },
                onActivate: async (context) => {
                    const logger = context.logger;
                    // 1. Generate or import Ed25519 keypair
                    const keyManager = config.provenance.keySource.type === 'import'
                        ? await AgentKeyManager.fromKeySource(agentId, config.provenance.keySource)
                        : await AgentKeyManager.generate(agentId);
                    logger?.info?.('[Provenance] Key pair ready. Public key: ' + keyManager.getPublicKeyBase64().substring(0, 16) + '...');
                    // 2. Create schema tables
                    const schemaScript = getProvenanceSchema(tablePrefix);
                    if (typeof storageAdapter.exec === 'function') {
                        await storageAdapter.exec(schemaScript);
                    }
                    else {
                        const statements = schemaScript
                            .split(';')
                            .map((s) => s.trim())
                            .filter(Boolean);
                        for (const statement of statements) {
                            await storageAdapter.run(statement);
                        }
                    }
                    logger?.info?.('[Provenance] Schema tables created.');
                    // 3. Store agent key record (public key for verification)
                    const existingKey = await storageAdapter.get(`SELECT agent_id FROM ${tablePrefix}agent_keys WHERE agent_id = ?`, [agentId]);
                    if (!existingKey) {
                        await storageAdapter.run(`INSERT INTO ${tablePrefix}agent_keys
               (agent_id, public_key, encrypted_private_key, created_at, key_algorithm)
               VALUES (?, ?, ?, ?, ?)`, [agentId, keyManager.getPublicKeyBase64(), null, new Date().toISOString(), 'Ed25519']);
                    }
                    else {
                        await storageAdapter.run(`UPDATE ${tablePrefix}agent_keys SET public_key = ? WHERE agent_id = ?`, [keyManager.getPublicKeyBase64(), agentId]);
                    }
                    // 4. Create SignedEventLedger
                    const ledger = new SignedEventLedger(storageAdapter, keyManager, agentId, config.provenance, tablePrefix);
                    await ledger.initialize();
                    logger?.info?.('[Provenance] Event ledger initialized.');
                    // 5. Create enforcement components
                    const revisionManager = new RevisionManager(storageAdapter, ledger, tablePrefix);
                    const tombstoneManager = new TombstoneManager(storageAdapter, ledger, tablePrefix);
                    const autonomyGuard = new AutonomyGuard(config.autonomy, ledger);
                    // 6. Create storage hooks
                    const hooks = createProvenanceHooks(config, ledger, config.storagePolicy.mode === 'revisioned' ? revisionManager : undefined, config.storagePolicy.mode === 'revisioned' ? tombstoneManager : undefined);
                    // 7. Create anchor provider from config
                    const anchorProvider = createAnchorProvider(config.provenance.anchorTarget);
                    logger?.info?.(`[Provenance] Anchor provider: ${anchorProvider.name} (proof level: ${anchorProvider.proofLevel})`);
                    // 8. Create AnchorManager with provider
                    const anchorManager = new AnchorManager(storageAdapter, ledger, keyManager, config, tablePrefix, anchorProvider);
                    // 9. Start periodic anchoring if configured
                    if (config.anchorIntervalMs > 0) {
                        anchorManager.start();
                        logger?.info?.(`[Provenance] Anchor manager started (interval: ${config.anchorIntervalMs}ms).`);
                    }
                    // 10. Append genesis event if sealed mode
                    let genesisEventId;
                    if (config.storagePolicy.mode === 'sealed') {
                        const genesisEvent = await ledger.appendEvent('genesis', {
                            agentId,
                            mode: config.storagePolicy.mode,
                            publicKey: keyManager.getPublicKeyBase64(),
                            configHash: JSON.stringify(config),
                        });
                        genesisEventId = genesisEvent.id;
                        await autonomyGuard.recordGenesis(genesisEventId);
                        logger?.info?.(`[Provenance] Genesis event recorded: ${genesisEventId}`);
                    }
                    result = {
                        keyManager,
                        ledger,
                        revisionManager,
                        tombstoneManager,
                        autonomyGuard,
                        anchorManager,
                        hooks,
                        genesisEventId,
                    };
                    payload.result = result;
                    logger?.info?.(`[Provenance] System activated in '${config.storagePolicy.mode}' mode.`);
                },
                onDeactivate: async () => {
                    if (result?.anchorManager) {
                        result.anchorManager.stop();
                    }
                    result = null;
                    payload.result = null;
                },
            },
        ],
        getResult() {
            return result;
        },
    };
    return pack;
}
//# sourceMappingURL=provenance-pack.js.map