import { describe, it, expect } from 'vitest';
import { PolicyAwareImageRouter } from '../PolicyAwareImageRouter.js';
import { createUncensoredModelCatalog } from '../../../core/llm/routing/UncensoredModelCatalog.js';

describe('PolicyAwareImageRouter — Capability Filtering', () => {
  const router = new PolicyAwareImageRouter(createUncensoredModelCatalog());

  it('filters chain to character-consistency-capable providers for safe tier', () => {
    const chain = router.getProviderChain('safe', ['character-consistency']);
    for (const id of chain) {
      expect(['replicate', 'fal', 'stable-diffusion-local']).toContain(id);
    }
    expect(chain).not.toContain('openai');
    expect(chain).not.toContain('stability');
  });

  it('returns full chain when no capabilities requested', () => {
    const chain = router.getProviderChain('safe');
    expect(chain.length).toBeGreaterThan(3);
  });

  it('filters mature chain by character-consistency', () => {
    const chain = router.getProviderChain('mature', ['character-consistency']);
    for (const id of chain) {
      expect(['replicate', 'fal', 'stable-diffusion-local']).toContain(id);
    }
  });

  it('returns empty chain if no provider matches all capabilities', () => {
    const chain = router.getProviderChain('safe', ['character-consistency', 'nonexistent-cap']);
    expect(chain).toHaveLength(0);
  });
});
