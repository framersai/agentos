/**
 * @file createAnchorProvider.ts
 * @description Factory function that creates an AnchorProvider from an AnchorTarget config.
 * External providers (e.g., Rekor, Ethereum) register via `registerAnchorProviderFactory()`
 * from extension packages like `@framers/agentos-ext-anchor-providers`.
 *
 * @module AgentOS/Provenance/Anchoring/Providers
 */

import type { AnchorTarget, AnchorProvider } from '../../types.js';
import { NoneProvider } from './NoneProvider.js';
import { CompositeAnchorProvider } from './CompositeAnchorProvider.js';

// =============================================================================
// Provider Registry
// =============================================================================

type ProviderFactory = (options: Record<string, unknown> | undefined) => AnchorProvider;
const providerRegistry = new Map<string, ProviderFactory>();

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
export function registerAnchorProviderFactory(
  type: string,
  factory: ProviderFactory,
): void {
  providerRegistry.set(type, factory);
}

// =============================================================================
// Factory
// =============================================================================

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
export function createAnchorProvider(target?: AnchorTarget): AnchorProvider {
  if (!target || target.type === 'none') {
    return new NoneProvider();
  }

  if (target.type === 'composite') {
    if (!target.targets || target.targets.length === 0) {
      return new NoneProvider();
    }
    const providers = target.targets.map(t => createAnchorProvider(t));
    return new CompositeAnchorProvider(providers);
  }

  // Look up registered factory from extensions
  const factory = providerRegistry.get(target.type);
  if (factory) {
    return factory(target.options);
  }

  if (target.type === 'custom') {
    console.warn('[createAnchorProvider] Custom provider type requires direct injection. Using NoneProvider.');
  } else {
    console.warn(
      `[createAnchorProvider] No provider registered for type "${target.type}". ` +
      'Did you forget to call registerExtensionProviders()? Using NoneProvider.',
    );
  }
  return new NoneProvider();
}
