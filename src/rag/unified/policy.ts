import { buildDefaultPlan } from './types.js';
import type { RetrievalPlan } from './types.js';

export type MemoryRetrievalProfile = 'fast' | 'balanced' | 'max-recall';

export interface MemoryRetrievalPolicy {
  profile?: MemoryRetrievalProfile;
  adaptive?: boolean;
  topK?: number;
  candidateMultiplier?: number;
  minScore?: number;
  contextBudgetChars?: number;
  reranker?: 'never' | 'adaptive' | 'always';
  hyde?: 'never' | 'adaptive' | 'always';
  graphExpansion?: boolean;
}

export interface ResolvedMemoryRetrievalPolicy {
  profile: MemoryRetrievalProfile;
  adaptive: boolean;
  topK: number;
  candidateMultiplier: number;
  minScore: number;
  contextBudgetChars: number;
  reranker: 'never' | 'adaptive' | 'always';
  hyde: 'never' | 'adaptive' | 'always';
  graphExpansion: boolean;
}

export const DEFAULT_MEMORY_RETRIEVAL_POLICY: ResolvedMemoryRetrievalPolicy = {
  profile: 'balanced',
  adaptive: true,
  topK: 8,
  candidateMultiplier: 3,
  minScore: 0.28,
  contextBudgetChars: 6_000,
  reranker: 'adaptive',
  hyde: 'adaptive',
  graphExpansion: true,
};

export function resolveMemoryRetrievalPolicy(
  input: MemoryRetrievalPolicy = {},
): ResolvedMemoryRetrievalPolicy {
  return {
    profile: input.profile ?? DEFAULT_MEMORY_RETRIEVAL_POLICY.profile,
    adaptive: input.adaptive ?? DEFAULT_MEMORY_RETRIEVAL_POLICY.adaptive,
    topK: input.topK ?? DEFAULT_MEMORY_RETRIEVAL_POLICY.topK,
    candidateMultiplier: input.candidateMultiplier ?? DEFAULT_MEMORY_RETRIEVAL_POLICY.candidateMultiplier,
    minScore: input.minScore ?? DEFAULT_MEMORY_RETRIEVAL_POLICY.minScore,
    contextBudgetChars: input.contextBudgetChars ?? DEFAULT_MEMORY_RETRIEVAL_POLICY.contextBudgetChars,
    reranker: input.reranker ?? DEFAULT_MEMORY_RETRIEVAL_POLICY.reranker,
    hyde: input.hyde ?? DEFAULT_MEMORY_RETRIEVAL_POLICY.hyde,
    graphExpansion: input.graphExpansion ?? DEFAULT_MEMORY_RETRIEVAL_POLICY.graphExpansion,
  };
}

export function getCandidateLimit(topK: number, candidateMultiplier: number): number {
  return Math.max(topK, topK * Math.max(candidateMultiplier, 1));
}

export function buildRetrievalPlanFromPolicy(
  input: MemoryRetrievalPolicy = {},
): RetrievalPlan {
  const policy = resolveMemoryRetrievalPolicy(input);
  const base =
    policy.profile === 'fast'
      ? buildDefaultPlan('simple')
      : policy.profile === 'max-recall'
        ? buildDefaultPlan('complex', { deepResearch: false })
        : buildDefaultPlan('moderate', {
            hyde: { enabled: false, hypothesisCount: 0 },
            deepResearch: false,
          });

  return {
    ...base,
    sources: {
      ...base.sources,
      graph: policy.graphExpansion ? true : base.sources.graph,
    },
    hyde: {
      enabled:
        policy.hyde === 'always' ||
        (policy.hyde === 'adaptive' && policy.profile === 'max-recall'),
      hypothesisCount: policy.profile === 'max-recall' ? Math.max(base.hyde.hypothesisCount, 1) : 0,
    },
    reasoning: `Memory retrieval policy: ${policy.profile}`,
    confidence: 1,
  };
}
