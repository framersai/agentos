/**
 * Public API for the AgentOS Provenance System.
 *
 * Re-exports all types, classes, and utilities for external consumption.
 *
 * Built-in anchor providers: {@link NoneProvider}, {@link CompositeAnchorProvider}.
 *
 * External anchor providers (Rekor, Ethereum, Solana, OpenTimestamps, WORM) are in the
 * `@framers/agentos-ext-anchor-providers` extension package.
 * See: https://github.com/framersai/agentos-extensions/tree/master/registry/curated/provenance/anchor-providers
 *
 * @module AgentOS/Provenance
 */
export type { StoragePolicyMode, StoragePolicyConfig, ProvenanceConfig, AgentKeySource, AnchorTarget, AutonomyConfig, ProvenanceSystemConfig, ProvenanceEventType, SignedEvent, AnchorRecord, RevisionRecord, TombstoneRecord, AgentKeyRecord, VerificationResult, VerificationError, VerificationBundle, ProofLevel, AnchorProviderResult, AnchorProvider, } from './types.js';
export { ProvenanceViolationError } from './types.js';
export { AgentKeyManager } from './crypto/AgentKeyManager.js';
export { HashChain } from './crypto/HashChain.js';
export { MerkleTree } from './crypto/MerkleTree.js';
export { profiles } from './config/PolicyProfiles.js';
export { getProvenanceSchema, getProvenanceDropSchema } from './schema/provenance-schema.js';
export { SignedEventLedger } from './ledger/SignedEventLedger.js';
export { createProvenanceHooks } from './enforcement/ProvenanceStorageHooks.js';
export { RevisionManager } from './enforcement/RevisionManager.js';
export { TombstoneManager } from './enforcement/TombstoneManager.js';
export { AutonomyGuard } from './enforcement/AutonomyGuard.js';
export { ChainVerifier } from './verification/ChainVerifier.js';
export { ConversationVerifier } from './verification/ConversationVerifier.js';
export type { ConversationVerificationResult } from './verification/ConversationVerifier.js';
export { BundleExporter } from './verification/BundleExporter.js';
export { AnchorManager } from './anchoring/AnchorManager.js';
export { NoneProvider } from './anchoring/providers/NoneProvider.js';
export { CompositeAnchorProvider } from './anchoring/providers/CompositeAnchorProvider.js';
export { createAnchorProvider, registerAnchorProviderFactory } from './anchoring/providers/createAnchorProvider.js';
//# sourceMappingURL=index.d.ts.map