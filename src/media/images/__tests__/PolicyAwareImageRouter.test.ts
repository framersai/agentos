import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyAwareImageRouter } from '../PolicyAwareImageRouter';
import { createUncensoredModelCatalog } from '../../../core/llm/routing/UncensoredModelCatalog';
import type { UncensoredModelCatalog } from '../../../core/llm/routing/UncensoredModelCatalog';

describe('PolicyAwareImageRouter', () => {
  let catalog: UncensoredModelCatalog;
  let router: PolicyAwareImageRouter;

  beforeEach(() => {
    catalog = createUncensoredModelCatalog();
    router = new PolicyAwareImageRouter(catalog);
  });

  // -------------------------------------------------------------------------
  // getPreferredProvider
  // -------------------------------------------------------------------------

  describe('getPreferredProvider', () => {
    it('returns null for safe tier', () => {
      expect(router.getPreferredProvider('safe')).toBeNull();
    });

    it('returns null for standard tier', () => {
      expect(router.getPreferredProvider('standard')).toBeNull();
    });

    it('returns replicate provider for private-adult tier', () => {
      const pref = router.getPreferredProvider('private-adult');
      expect(pref).not.toBeNull();
      expect(pref!.providerId).toBe('replicate');
      expect(pref!.modelId).toBeTruthy();
      expect(pref!.displayName).toBeTruthy();
    });

    it('returns replicate provider for mature tier', () => {
      const pref = router.getPreferredProvider('mature');
      expect(pref).not.toBeNull();
      expect(pref!.providerId).toBe('replicate');
    });

    it('filters by face-consistency capability', () => {
      const pref = router.getPreferredProvider('private-adult', [
        'face-consistency',
      ]);
      expect(pref).not.toBeNull();
      expect(pref!.providerId).toBe('replicate');
      // Should be one of the face-consistency models
      expect(
        ['zsxkib/instant-id', 'lucataco/ip-adapter-faceid-sdxl'].includes(
          pref!.modelId,
        ),
      ).toBe(true);
    });

    it('returns null when no models match impossible capability', () => {
      const pref = router.getPreferredProvider('private-adult', [
        'quantum-rendering',
      ]);
      expect(pref).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getProviderChain
  // -------------------------------------------------------------------------

  describe('getProviderChain', () => {
    it('returns default chain for safe tier', () => {
      const chain = router.getProviderChain('safe');
      expect(chain).toEqual(['openai', 'stability', 'fal', 'replicate']);
    });

    it('returns default chain for standard tier', () => {
      const chain = router.getProviderChain('standard');
      expect(chain).toEqual(['openai', 'stability', 'fal', 'replicate']);
    });

    it('returns uncensored chain for private-adult tier', () => {
      const chain = router.getProviderChain('private-adult');
      expect(chain).toEqual(['replicate', 'fal', 'stable-diffusion-local']);
    });

    it('returns uncensored chain for mature tier', () => {
      const chain = router.getProviderChain('mature');
      expect(chain).toEqual(['replicate', 'fal', 'stable-diffusion-local']);
    });

    it('returns a new array each time (no shared references)', () => {
      const chain1 = router.getProviderChain('safe');
      const chain2 = router.getProviderChain('safe');
      expect(chain1).toEqual(chain2);
      expect(chain1).not.toBe(chain2);
    });
  });
});
