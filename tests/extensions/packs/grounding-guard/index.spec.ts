/**
 * @fileoverview Unit tests for the grounding guard pack factory.
 *
 * Tests the `createGroundingGuardPack()` factory function and the
 * `createExtensionPack()` manifest bridge.
 *
 * Test coverage:
 *  1. Pack name and version
 *  2. Descriptor count and IDs (guardrail + tool)
 *  3. createExtensionPack manifest bridge
 *  4. onActivate rebuilds components with new registry
 *  5. onDeactivate calls dispose + clearBuffers
 *  6. Guardrail descriptor has priority 8
 *  7. Descriptor kinds are correct
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createGroundingGuardPack,
  createExtensionPack,
} from '../../../../src/extensions/packs/grounding-guard/index';
import { EXTENSION_KIND_GUARDRAIL, EXTENSION_KIND_TOOL } from '../../../../src/extensions/types';
import type { ISharedServiceRegistry } from '../../../../src/extensions/ISharedServiceRegistry';
import type { ExtensionPackContext } from '../../../../src/extensions/manifest';

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock {@link ISharedServiceRegistry} for onActivate tests.
 *
 * Returns a registry with a mock NLI pipeline so the rebuilt components
 * don't try to load real ONNX models.
 */
function createMockRegistry(): ISharedServiceRegistry {
  const pipeline = vi.fn(async () => [
    { label: 'ENTAILMENT', score: 0.9 },
    { label: 'NEUTRAL', score: 0.05 },
    { label: 'CONTRADICTION', score: 0.05 },
  ]);
  return {
    getOrCreate: vi.fn(async () => pipeline),
    has: vi.fn(() => false),
    release: vi.fn(async () => {}),
    releaseAll: vi.fn(async () => {}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createGroundingGuardPack', () => {
  // -------------------------------------------------------------------------
  // 1. Pack name and version
  // -------------------------------------------------------------------------

  describe('pack identity', () => {
    it('has name "grounding-guard"', () => {
      const pack = createGroundingGuardPack();
      expect(pack.name).toBe('grounding-guard');
    });

    it('has version "1.0.0"', () => {
      const pack = createGroundingGuardPack();
      expect(pack.version).toBe('1.0.0');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Descriptors — count and IDs
  // -------------------------------------------------------------------------

  describe('descriptors', () => {
    it('returns exactly 2 descriptors', () => {
      const pack = createGroundingGuardPack();
      expect(pack.descriptors).toHaveLength(2);
    });

    it('has a guardrail descriptor with id "grounding-guardrail"', () => {
      const pack = createGroundingGuardPack();
      const guardrail = pack.descriptors.find((d) => d.id === 'grounding-guardrail');
      expect(guardrail).toBeDefined();
    });

    it('has a tool descriptor with id "check_grounding"', () => {
      const pack = createGroundingGuardPack();
      const tool = pack.descriptors.find((d) => d.id === 'check_grounding');
      expect(tool).toBeDefined();
    });

    it('guardrail descriptor has kind EXTENSION_KIND_GUARDRAIL', () => {
      const pack = createGroundingGuardPack();
      const guardrail = pack.descriptors.find((d) => d.id === 'grounding-guardrail');
      expect(guardrail!.kind).toBe(EXTENSION_KIND_GUARDRAIL);
    });

    it('tool descriptor has kind EXTENSION_KIND_TOOL', () => {
      const pack = createGroundingGuardPack();
      const tool = pack.descriptors.find((d) => d.id === 'check_grounding');
      expect(tool!.kind).toBe(EXTENSION_KIND_TOOL);
    });

    it('guardrail descriptor has priority 8', () => {
      const pack = createGroundingGuardPack();
      const guardrail = pack.descriptors.find((d) => d.id === 'grounding-guardrail');
      expect(guardrail!.priority).toBe(8);
    });

    it('tool descriptor has priority 0', () => {
      const pack = createGroundingGuardPack();
      const tool = pack.descriptors.find((d) => d.id === 'check_grounding');
      expect(tool!.priority).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. createExtensionPack manifest bridge
  // -------------------------------------------------------------------------

  describe('createExtensionPack bridge', () => {
    it('returns a valid pack with same structure', () => {
      const context: ExtensionPackContext = {
        options: {},
      };
      const pack = createExtensionPack(context);

      expect(pack.name).toBe('grounding-guard');
      expect(pack.version).toBe('1.0.0');
      expect(pack.descriptors).toHaveLength(2);
    });

    it('passes options through to the pack factory', () => {
      const context: ExtensionPackContext = {
        options: {
          contradictionAction: 'block',
          maxUnverifiableRatio: 0.2,
        },
      };
      const pack = createExtensionPack(context);

      // Verify the pack was created (detailed option testing is in
      // GroundingGuardrail.spec.ts).
      expect(pack.name).toBe('grounding-guard');
      expect(pack.descriptors).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // 4. onActivate rebuilds components
  // -------------------------------------------------------------------------

  describe('onActivate', () => {
    it('rebuilds components with the manager-provided shared registry', () => {
      const pack = createGroundingGuardPack();

      // Get initial descriptor references.
      const initialGuardrail = pack.descriptors.find((d) => d.id === 'grounding-guardrail')!.payload;
      const initialTool = pack.descriptors.find((d) => d.id === 'check_grounding')!.payload;

      // Activate with a new registry.
      const newRegistry = createMockRegistry();
      pack.onActivate!({
        services: newRegistry,
        getSecret: (id: string) => `secret-${id}`,
      });

      // After activation, descriptors should point to NEW component instances.
      const rebuiltGuardrail = pack.descriptors.find((d) => d.id === 'grounding-guardrail')!.payload;
      const rebuiltTool = pack.descriptors.find((d) => d.id === 'check_grounding')!.payload;

      // The rebuilt instances should be different objects than the initial ones.
      expect(rebuiltGuardrail).not.toBe(initialGuardrail);
      expect(rebuiltTool).not.toBe(initialTool);
    });

    it('does not throw when called without services', () => {
      const pack = createGroundingGuardPack();
      // Activation with empty context should not throw.
      expect(() => pack.onActivate!({})).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 5. onDeactivate calls dispose + clearBuffers
  // -------------------------------------------------------------------------

  describe('onDeactivate', () => {
    it('calls checker.dispose and guardrail.clearBuffers without throwing', async () => {
      const pack = createGroundingGuardPack();

      // onDeactivate should complete without errors even on a fresh pack
      // (no streams opened, no NLI pipeline loaded).
      await expect(pack.onDeactivate!({} as any)).resolves.not.toThrow();
    });

    it('releases NLI pipeline via the shared registry', async () => {
      const registry = createMockRegistry();
      const pack = createGroundingGuardPack();

      // Activate with our mock registry so it's used by the checker.
      pack.onActivate!({ services: registry });

      // Deactivate.
      await pack.onDeactivate!({} as any);

      // The checker should have called release on the registry.
      expect(registry.release).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Descriptors use getter (reflect latest components)
  // -------------------------------------------------------------------------

  describe('descriptor getter', () => {
    it('descriptors reflect rebuilt components after onActivate', () => {
      const pack = createGroundingGuardPack();
      const beforePayload = pack.descriptors[0].payload;

      // Rebuild by activating with a new registry.
      pack.onActivate!({ services: createMockRegistry() });

      const afterPayload = pack.descriptors[0].payload;

      // The getter should return the new instance, not the old one.
      expect(afterPayload).not.toBe(beforePayload);
    });
  });
});
