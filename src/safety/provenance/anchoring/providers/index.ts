/**
 * @file index.ts
 * @description Public API for anchor providers.
 * Core providers (NoneProvider, CompositeAnchorProvider) are built-in.
 * External providers (Rekor, Ethereum, Solana, etc.) are in @framers/agentos-ext-anchor-providers.
 *
 * @module AgentOS/Provenance/Anchoring/Providers
 */

export { NoneProvider } from './NoneProvider.js';
export { CompositeAnchorProvider } from './CompositeAnchorProvider.js';
export { createAnchorProvider, registerAnchorProviderFactory } from './createAnchorProvider.js';
