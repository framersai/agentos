/**
 * @module io/segmentation/SegmentationProviderRegistry
 *
 * Resolves segmentation providers by id, lazily constructing built-ins from
 * environment configuration on first use. Custom providers and tests can
 * inject instances via {@link registerSegmentationProvider}.
 */
import { ReplicateSegmentationProvider } from './providers/ReplicateSegmentationProvider.js';
import type { ISegmentationProvider, SegmentationProviderId } from './types.js';

const instances = new Map<string, ISegmentationProvider>();

/** Register (or override) a provider instance. */
export function registerSegmentationProvider(id: string, provider: ISegmentationProvider): void {
  instances.set(id, provider);
}

/** Clear all cached/registered instances. */
export function resetSegmentationProviders(): void {
  instances.clear();
}

/**
 * Resolve a provider, lazily constructing built-ins from env on first use.
 *
 * @throws when the provider id is unknown or required configuration is missing.
 */
export async function resolveSegmentationProvider(
  id: SegmentationProviderId = 'replicate',
): Promise<ISegmentationProvider> {
  const existing = instances.get(id);
  if (existing) return existing;

  if (id === 'replicate') {
    const apiKey = process.env.REPLICATE_API_TOKEN?.trim();
    if (!apiKey) {
      throw new Error('Segmentation provider "replicate" requires REPLICATE_API_TOKEN.');
    }
    const provider = new ReplicateSegmentationProvider();
    await provider.initialize({ apiKey });
    instances.set(id, provider);
    return provider;
  }

  throw new Error(`Unknown segmentation provider "${id}".`);
}
