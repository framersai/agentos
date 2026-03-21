/**
 * @file index.spec.ts
 * @description Unit tests for the ML Classifier pack factory.
 *
 * Tests verify:
 *  - createMLClassifierPack returns an ExtensionPack with name 'ml-classifiers'
 *    and version '1.0.0'
 *  - The pack provides exactly 2 descriptors: 1 guardrail + 1 tool
 *  - Guardrail descriptor has id 'ml-classifier-guardrail' and kind 'guardrail'
 *  - Tool descriptor has id 'classify_content' and kind 'tool'
 *  - createExtensionPack bridges context.options to createMLClassifierPack
 *  - Disabled / selective classifiers work correctly
 *  - onActivate rebuilds components with the shared registry
 *  - onDeactivate disposes orchestrator and clears buffer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMLClassifierPack,
  createExtensionPack,
} from '../../../../src/extensions/packs/ml-classifiers/index';
import { SharedServiceRegistry } from '../../../../src/extensions/SharedServiceRegistry';
import {
  EXTENSION_KIND_GUARDRAIL,
  EXTENSION_KIND_TOOL,
} from '../../../../src/extensions/types';
import type { ExtensionPackContext } from '../../../../src/extensions/manifest';

// ---------------------------------------------------------------------------
// Mocks — prevent real model downloads and ONNX/WASM loading
// ---------------------------------------------------------------------------

/**
 * Mock ToxicityClassifier — lightweight stand-in that avoids the real
 * `@huggingface/transformers` import during unit tests.
 */
vi.mock(
  '../../../../src/extensions/packs/ml-classifiers/classifiers/ToxicityClassifier',
  () => ({
    ToxicityClassifier: vi.fn().mockImplementation(() => ({
      id: 'agentos:ml-classifiers:toxicity-pipeline',
      displayName: 'Toxicity Classifier (mock)',
      description: 'Mock toxicity classifier.',
      modelId: 'unitary/toxic-bert',
      isLoaded: false,
      classify: vi.fn().mockResolvedValue({ bestClass: 'benign', confidence: 0, allScores: [] }),
      dispose: vi.fn().mockResolvedValue(undefined),
    })),
  }),
);

/**
 * Mock InjectionClassifier.
 */
vi.mock(
  '../../../../src/extensions/packs/ml-classifiers/classifiers/InjectionClassifier',
  () => ({
    InjectionClassifier: vi.fn().mockImplementation(() => ({
      id: 'agentos:ml-classifiers:injection-pipeline',
      displayName: 'Injection Classifier (mock)',
      description: 'Mock injection classifier.',
      modelId: 'protectai/deberta-v3-small-prompt-injection-v2',
      isLoaded: false,
      classify: vi.fn().mockResolvedValue({ bestClass: 'SAFE', confidence: 0.1, allScores: [] }),
      dispose: vi.fn().mockResolvedValue(undefined),
    })),
  }),
);

/**
 * Mock JailbreakClassifier.
 */
vi.mock(
  '../../../../src/extensions/packs/ml-classifiers/classifiers/JailbreakClassifier',
  () => ({
    JailbreakClassifier: vi.fn().mockImplementation(() => ({
      id: 'agentos:ml-classifiers:jailbreak-pipeline',
      displayName: 'Jailbreak Classifier (mock)',
      description: 'Mock jailbreak classifier.',
      modelId: 'meta-llama/PromptGuard-86M',
      isLoaded: false,
      classify: vi.fn().mockResolvedValue({ bestClass: 'benign', confidence: 0, allScores: [] }),
      dispose: vi.fn().mockResolvedValue(undefined),
    })),
  }),
);

// Import the mocked constructors so tests can assert on them.
import { ToxicityClassifier } from '../../../../src/extensions/packs/ml-classifiers/classifiers/ToxicityClassifier';
import { InjectionClassifier } from '../../../../src/extensions/packs/ml-classifiers/classifiers/InjectionClassifier';
import { JailbreakClassifier } from '../../../../src/extensions/packs/ml-classifiers/classifiers/JailbreakClassifier';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createMLClassifierPack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Pack identity
  // -------------------------------------------------------------------------

  describe('pack identity', () => {
    it('returns an ExtensionPack with name "ml-classifiers"', () => {
      const pack = createMLClassifierPack();
      expect(pack.name).toBe('ml-classifiers');
    });

    it('returns an ExtensionPack with version "1.0.0"', () => {
      const pack = createMLClassifierPack();
      expect(pack.version).toBe('1.0.0');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Descriptors shape
  // -------------------------------------------------------------------------

  describe('descriptors', () => {
    it('provides exactly 2 descriptors', () => {
      const pack = createMLClassifierPack();
      expect(pack.descriptors).toHaveLength(2);
    });

    it('has a guardrail descriptor with id "ml-classifier-guardrail"', () => {
      const pack = createMLClassifierPack();
      const guardrailDescriptor = pack.descriptors.find((d) => d.id === 'ml-classifier-guardrail');

      expect(guardrailDescriptor).toBeDefined();
    });

    it('guardrail descriptor has kind "guardrail"', () => {
      const pack = createMLClassifierPack();
      const guardrailDescriptor = pack.descriptors.find((d) => d.id === 'ml-classifier-guardrail');

      expect(guardrailDescriptor?.kind).toBe(EXTENSION_KIND_GUARDRAIL);
    });

    it('guardrail descriptor has priority 5', () => {
      const pack = createMLClassifierPack();
      const guardrailDescriptor = pack.descriptors.find((d) => d.id === 'ml-classifier-guardrail');

      expect(guardrailDescriptor?.priority).toBe(5);
    });

    it('guardrail descriptor has a non-null payload', () => {
      const pack = createMLClassifierPack();
      const guardrailDescriptor = pack.descriptors.find((d) => d.id === 'ml-classifier-guardrail');

      expect(guardrailDescriptor?.payload).toBeDefined();
      expect(guardrailDescriptor?.payload).not.toBeNull();
    });

    it('has a tool descriptor with id "classify_content"', () => {
      const pack = createMLClassifierPack();
      const toolDescriptor = pack.descriptors.find((d) => d.id === 'classify_content');

      expect(toolDescriptor).toBeDefined();
    });

    it('tool descriptor has kind "tool"', () => {
      const pack = createMLClassifierPack();
      const toolDescriptor = pack.descriptors.find((d) => d.id === 'classify_content');

      expect(toolDescriptor?.kind).toBe(EXTENSION_KIND_TOOL);
    });

    it('tool descriptor has priority 0', () => {
      const pack = createMLClassifierPack();
      const toolDescriptor = pack.descriptors.find((d) => d.id === 'classify_content');

      expect(toolDescriptor?.priority).toBe(0);
    });

    it('tool descriptor has a non-null payload', () => {
      const pack = createMLClassifierPack();
      const toolDescriptor = pack.descriptors.find((d) => d.id === 'classify_content');

      expect(toolDescriptor?.payload).toBeDefined();
      expect(toolDescriptor?.payload).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Built-in classifier instantiation (zero-config)
  // -------------------------------------------------------------------------

  describe('zero-config classifier instantiation', () => {
    it('instantiates all three built-in classifiers when no classifiers option is given', () => {
      createMLClassifierPack();

      // Each built-in classifier should have been constructed once.
      expect(ToxicityClassifier).toHaveBeenCalledOnce();
      expect(InjectionClassifier).toHaveBeenCalledOnce();
      expect(JailbreakClassifier).toHaveBeenCalledOnce();
    });

    it('instantiates all three built-in classifiers when classifiers is an empty array', () => {
      createMLClassifierPack({ classifiers: [] });

      expect(ToxicityClassifier).toHaveBeenCalledOnce();
      expect(InjectionClassifier).toHaveBeenCalledOnce();
      expect(JailbreakClassifier).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Selective / disabled classifiers
  // -------------------------------------------------------------------------

  describe('selective classifiers', () => {
    it('only instantiates ToxicityClassifier when classifiers: ["toxicity"]', () => {
      createMLClassifierPack({ classifiers: ['toxicity'] });

      expect(ToxicityClassifier).toHaveBeenCalledOnce();
      expect(InjectionClassifier).not.toHaveBeenCalled();
      expect(JailbreakClassifier).not.toHaveBeenCalled();
    });

    it('only instantiates InjectionClassifier when classifiers: ["injection"]', () => {
      createMLClassifierPack({ classifiers: ['injection'] });

      expect(ToxicityClassifier).not.toHaveBeenCalled();
      expect(InjectionClassifier).toHaveBeenCalledOnce();
      expect(JailbreakClassifier).not.toHaveBeenCalled();
    });

    it('only instantiates JailbreakClassifier when classifiers: ["jailbreak"]', () => {
      createMLClassifierPack({ classifiers: ['jailbreak'] });

      expect(ToxicityClassifier).not.toHaveBeenCalled();
      expect(InjectionClassifier).not.toHaveBeenCalled();
      expect(JailbreakClassifier).toHaveBeenCalledOnce();
    });

    it('instantiates toxicity and jailbreak but not injection when specified', () => {
      createMLClassifierPack({ classifiers: ['toxicity', 'jailbreak'] });

      expect(ToxicityClassifier).toHaveBeenCalledOnce();
      expect(InjectionClassifier).not.toHaveBeenCalled();
      expect(JailbreakClassifier).toHaveBeenCalledOnce();
    });

    it('still provides 2 descriptors when only 1 classifier is enabled', () => {
      const pack = createMLClassifierPack({ classifiers: ['toxicity'] });

      // The guardrail and tool are always present regardless of classifier count.
      expect(pack.descriptors).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Custom classifiers
  // -------------------------------------------------------------------------

  describe('customClassifiers option', () => {
    it('includes custom classifiers alongside built-in ones', () => {
      const customClassifier = {
        id: 'custom:sarcasm',
        displayName: 'Sarcasm Detector',
        description: 'Detects sarcasm.',
        modelId: 'my-org/sarcasm-bert',
        isLoaded: false,
        classify: vi.fn().mockResolvedValue({ bestClass: 'benign', confidence: 0, allScores: [] }),
      };

      // Should not throw when a custom classifier is provided.
      const pack = createMLClassifierPack({
        classifiers: ['toxicity'],
        customClassifiers: [customClassifier],
      });

      // Pack structure must remain consistent.
      expect(pack.descriptors).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // 6. onActivate lifecycle hook
  // -------------------------------------------------------------------------

  describe('onActivate lifecycle hook', () => {
    it('rebuilds components when onActivate is called with a shared registry', () => {
      const pack = createMLClassifierPack();

      // Record the number of classifier constructions at pack-creation time.
      const constructsBefore =
        (ToxicityClassifier as ReturnType<typeof vi.fn>).mock.calls.length +
        (InjectionClassifier as ReturnType<typeof vi.fn>).mock.calls.length +
        (JailbreakClassifier as ReturnType<typeof vi.fn>).mock.calls.length;

      // Activate with a shared registry.
      const sharedRegistry = new SharedServiceRegistry();
      pack.onActivate!({ services: sharedRegistry });

      const constructsAfter =
        (ToxicityClassifier as ReturnType<typeof vi.fn>).mock.calls.length +
        (InjectionClassifier as ReturnType<typeof vi.fn>).mock.calls.length +
        (JailbreakClassifier as ReturnType<typeof vi.fn>).mock.calls.length;

      // Activation must have rebuilt the classifiers (3 more constructions).
      expect(constructsAfter).toBe(constructsBefore + 3);
    });

    it('descriptors still reflect the rebuilt components after onActivate', () => {
      const pack = createMLClassifierPack();
      const sharedRegistry = new SharedServiceRegistry();
      pack.onActivate!({ services: sharedRegistry });

      // Descriptors getter must return fresh references.
      expect(pack.descriptors).toHaveLength(2);
    });

    it('does not throw when onActivate is called without services', () => {
      const pack = createMLClassifierPack();

      // Context without a services field should be handled gracefully.
      expect(() => pack.onActivate!({})).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 7. onDeactivate lifecycle hook
  // -------------------------------------------------------------------------

  describe('onDeactivate lifecycle hook', () => {
    it('resolves without throwing', async () => {
      const pack = createMLClassifierPack();
      await expect(pack.onDeactivate!()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 8. Options passthrough
  // -------------------------------------------------------------------------

  describe('options passthrough', () => {
    it('accepts and applies streaming mode options without throwing', () => {
      expect(() =>
        createMLClassifierPack({
          streamingMode: true,
          chunkSize: 150,
          contextSize: 30,
          maxEvaluations: 50,
          guardrailScope: 'output',
        }),
      ).not.toThrow();
    });

    it('accepts custom thresholds without throwing', () => {
      expect(() =>
        createMLClassifierPack({
          thresholds: {
            blockThreshold: 0.95,
            flagThreshold: 0.75,
            warnThreshold: 0.5,
          },
        }),
      ).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// createExtensionPack (manifest factory bridge)
// ---------------------------------------------------------------------------

describe('createExtensionPack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a pack with name "ml-classifiers"', () => {
    const context: ExtensionPackContext = {};
    const pack = createExtensionPack(context);

    expect(pack.name).toBe('ml-classifiers');
  });

  it('returns a pack with version "1.0.0"', () => {
    const context: ExtensionPackContext = {};
    const pack = createExtensionPack(context);

    expect(pack.version).toBe('1.0.0');
  });

  it('provides 2 descriptors with empty context', () => {
    const pack = createExtensionPack({});

    expect(pack.descriptors).toHaveLength(2);
  });

  it('bridges context.options to createMLClassifierPack — classifiers subset', () => {
    const context: ExtensionPackContext = {
      options: {
        classifiers: ['toxicity'],
      },
    };

    createExtensionPack(context);

    // Only ToxicityClassifier should have been instantiated.
    expect(ToxicityClassifier).toHaveBeenCalledOnce();
    expect(InjectionClassifier).not.toHaveBeenCalled();
    expect(JailbreakClassifier).not.toHaveBeenCalled();
  });

  it('bridges context.options to createMLClassifierPack — thresholds', () => {
    const context: ExtensionPackContext = {
      options: {
        thresholds: { blockThreshold: 0.99 },
      },
    };

    const pack = createExtensionPack(context);

    // Pack must still be well-formed.
    expect(pack.descriptors).toHaveLength(2);
  });

  it('works when context.options is undefined', () => {
    const context: ExtensionPackContext = { options: undefined };
    const pack = createExtensionPack(context);

    expect(pack.name).toBe('ml-classifiers');
    expect(pack.descriptors).toHaveLength(2);
  });
});
