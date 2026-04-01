/**
 * @file createAnchorProvider.ts
 * @description Factory function that creates an AnchorProvider from an AnchorTarget config.
 * External providers (e.g., Rekor, Ethereum) register via `registerAnchorProviderFactory()`
 * from extension packages like `@framers/agentos-ext-anchor-providers`.
 *
 * @module AgentOS/Provenance/Anchoring/Providers
 */
import type { AnchorTarget, AnchorProvider } from '../../types.js';
type ProviderFactory = (options: Record<string, unknown> | undefined) => AnchorProvider;
/**
 * Register an external AnchorProvider factory for a given anchor target type.
 * Called by extension packages (e.g., @framers/agentos-ext-anchor-providers) at startup.
 *
 * @example
 * ```typescript
 * import { registerAnchorProviderFactory } from '@framers/agentos';
 * import { RekorProvider } from '@framers/agentos-ext-anchor-providers';
 *
 * registerAnchorProviderFactory('rekor', (opts) => new RekorProvider(opts));
 * ```
 */
export declare function registerAnchorProviderFactory(type: string, factory: ProviderFactory): void;
/**
 * Create an AnchorProvider from an AnchorTarget configuration.
 * Returns NoneProvider when target is undefined or type is 'none'.
 *
 * For external provider types (rekor, ethereum, opentimestamps, worm-snapshot),
 * the corresponding factory must first be registered via `registerAnchorProviderFactory()`.
 *
 * The `@framers/agentos-ext-anchor-providers` extension package provides
 * a `registerExtensionProviders()` function that registers all curated external providers.
 *
 * @see https://github.com/framersai/agentos-extensions/tree/master/registry/curated/provenance/anchor-providers
 */
export declare function createAnchorProvider(target?: AnchorTarget): AnchorProvider;
export {};
//# sourceMappingURL=createAnchorProvider.d.ts.map