import type { ModelRouteParams } from '../../core/llm/routing/IModelRouter.js';

export interface HostLLMPolicy {
  optimizationPreference?: 'cost' | 'speed' | 'quality' | 'balanced';
  requiredCapabilities?: string[];
  allowedProviders?: string[];
  fallbackProviders?: Array<{ provider: string; model?: string }>;
  policyTier?: 'safe' | 'standard' | 'mature' | 'private-adult';
  cacheDiscipline?: 'none' | 'stable_prefix' | 'structured_blocks';
}

export function normalizeHostLLMPolicy(input: HostLLMPolicy = {}): Required<HostLLMPolicy> {
  return {
    optimizationPreference: input.optimizationPreference ?? 'balanced',
    requiredCapabilities: input.requiredCapabilities ?? [],
    allowedProviders: input.allowedProviders ?? [],
    fallbackProviders: input.fallbackProviders ?? [],
    policyTier: input.policyTier ?? 'standard',
    cacheDiscipline: input.cacheDiscipline ?? 'none',
  };
}

export function hostPolicyToRouteParams(hostPolicy?: HostLLMPolicy): Partial<ModelRouteParams> {
  if (!hostPolicy) return {};

  const normalized = normalizeHostLLMPolicy(hostPolicy);
  return {
    optimizationPreference: normalized.optimizationPreference,
    requiredCapabilities:
      normalized.requiredCapabilities.length > 0 ? [...normalized.requiredCapabilities] : undefined,
    preferredProviderIds:
      normalized.allowedProviders.length > 0 ? [...normalized.allowedProviders] : undefined,
    policyTier: normalized.policyTier,
  };
}

export function mergeRequiredCapabilities(
  ...capabilitySets: Array<string[] | undefined>
): string[] | undefined {
  const merged = capabilitySets
    .flatMap((capabilities) => capabilities ?? [])
    .filter((capability, index, allCapabilities) => {
      return capability.length > 0 && allCapabilities.indexOf(capability) === index;
    });

  return merged.length > 0 ? merged : undefined;
}
