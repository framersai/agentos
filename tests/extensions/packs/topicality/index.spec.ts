/**
 * @fileoverview Unit tests for the Topicality pack factory.
 *
 * Tests verify:
 *  - createTopicalityPack returns an ExtensionPack with name 'topicality'
 *    and version '1.0.0'
 *  - The pack provides exactly 2 descriptors: 1 guardrail + 1 tool
 *  - Guardrail descriptor has id 'topicality-guardrail' and kind 'guardrail'
 *  - Tool descriptor has id 'check_topic' and kind 'tool'
 *  - createExtensionPack bridges context.options to createTopicalityPack
 *  - onActivate rebuilds components with the shared registry
 *  - onDeactivate clears drift tracker sessions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTopicalityPack,
  createExtensionPack,
} from '../../../../src/extensions/packs/topicality/index';
import { SharedServiceRegistry } from '../../../../src/extensions/SharedServiceRegistry';
import {
  EXTENSION_KIND_GUARDRAIL,
  EXTENSION_KIND_TOOL,
} from '../../../../src/extensions/types';
import type { ExtensionPackContext } from '../../../../src/extensions/manifest';
import type { TopicalityPackOptions, TopicDescriptor } from '../../../../src/extensions/packs/topicality/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A simple allowed topic for testing. */
const BILLING_TOPIC: TopicDescriptor = {
  id: 'billing',
  name: 'Billing & Payments',
  description: 'Questions about invoices and charges.',
  examples: ['Why was I charged twice?'],
};

/** Mock embedding function to avoid real model calls. */
const mockEmbeddingFn = vi.fn(async (texts: string[]): Promise<number[][]> => {
  return texts.map(() => [0.5, 0.5, 0.5]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTopicalityPack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Pack identity
  // -------------------------------------------------------------------------

  describe('pack identity', () => {
    it('returns an ExtensionPack with name "topicality"', () => {
      const pack = createTopicalityPack();

      expect(pack.name).toBe('topicality');
    });

    it('returns an ExtensionPack with version "1.0.0"', () => {
      const pack = createTopicalityPack();

      expect(pack.version).toBe('1.0.0');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Descriptors shape
  // -------------------------------------------------------------------------

  describe('descriptors', () => {
    it('provides exactly 2 descriptors', () => {
      const pack = createTopicalityPack();

      expect(pack.descriptors).toHaveLength(2);
    });

    it('has a guardrail descriptor with id "topicality-guardrail"', () => {
      const pack = createTopicalityPack();
      const guardrailDescriptor = pack.descriptors.find(
        (d) => d.id === 'topicality-guardrail',
      );

      expect(guardrailDescriptor).toBeDefined();
    });

    it('guardrail descriptor has kind "guardrail"', () => {
      const pack = createTopicalityPack();
      const guardrailDescriptor = pack.descriptors.find(
        (d) => d.id === 'topicality-guardrail',
      );

      expect(guardrailDescriptor?.kind).toBe(EXTENSION_KIND_GUARDRAIL);
    });

    it('guardrail descriptor has priority 3', () => {
      const pack = createTopicalityPack();
      const guardrailDescriptor = pack.descriptors.find(
        (d) => d.id === 'topicality-guardrail',
      );

      expect(guardrailDescriptor?.priority).toBe(3);
    });

    it('guardrail descriptor has a non-null payload', () => {
      const pack = createTopicalityPack();
      const guardrailDescriptor = pack.descriptors.find(
        (d) => d.id === 'topicality-guardrail',
      );

      expect(guardrailDescriptor?.payload).toBeDefined();
      expect(guardrailDescriptor?.payload).not.toBeNull();
    });

    it('has a tool descriptor with id "check_topic"', () => {
      const pack = createTopicalityPack();
      const toolDescriptor = pack.descriptors.find((d) => d.id === 'check_topic');

      expect(toolDescriptor).toBeDefined();
    });

    it('tool descriptor has kind "tool"', () => {
      const pack = createTopicalityPack();
      const toolDescriptor = pack.descriptors.find((d) => d.id === 'check_topic');

      expect(toolDescriptor?.kind).toBe(EXTENSION_KIND_TOOL);
    });

    it('tool descriptor has priority 0', () => {
      const pack = createTopicalityPack();
      const toolDescriptor = pack.descriptors.find((d) => d.id === 'check_topic');

      expect(toolDescriptor?.priority).toBe(0);
    });

    it('tool descriptor has a non-null payload', () => {
      const pack = createTopicalityPack();
      const toolDescriptor = pack.descriptors.find((d) => d.id === 'check_topic');

      expect(toolDescriptor?.payload).toBeDefined();
      expect(toolDescriptor?.payload).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Options passthrough
  // -------------------------------------------------------------------------

  describe('options passthrough', () => {
    it('accepts allowed and forbidden topics without throwing', () => {
      expect(() =>
        createTopicalityPack({
          allowedTopics: [BILLING_TOPIC],
          forbiddenTopics: [],
          embeddingFn: mockEmbeddingFn,
        }),
      ).not.toThrow();
    });

    it('accepts custom thresholds and drift config', () => {
      expect(() =>
        createTopicalityPack({
          allowedThreshold: 0.5,
          forbiddenThreshold: 0.8,
          enableDriftDetection: true,
          drift: { alpha: 0.5, driftStreakLimit: 5 },
          embeddingFn: mockEmbeddingFn,
        }),
      ).not.toThrow();
    });

    it('accepts guardrailScope option', () => {
      expect(() =>
        createTopicalityPack({
          guardrailScope: 'both',
          embeddingFn: mockEmbeddingFn,
        }),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 4. onActivate lifecycle hook
  // -------------------------------------------------------------------------

  describe('onActivate lifecycle hook', () => {
    it('does not throw when called with a shared registry', () => {
      const pack = createTopicalityPack({ embeddingFn: mockEmbeddingFn });
      const sharedRegistry = new SharedServiceRegistry();

      expect(() => pack.onActivate!({ services: sharedRegistry })).not.toThrow();
    });

    it('descriptors still reflect rebuilt components after onActivate', () => {
      const pack = createTopicalityPack({ embeddingFn: mockEmbeddingFn });
      const sharedRegistry = new SharedServiceRegistry();
      pack.onActivate!({ services: sharedRegistry });

      // Descriptors getter must return fresh references.
      expect(pack.descriptors).toHaveLength(2);
    });

    it('does not throw when onActivate is called without services', () => {
      const pack = createTopicalityPack({ embeddingFn: mockEmbeddingFn });

      // Context without a services field should be handled gracefully.
      expect(() => pack.onActivate!({})).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 5. onDeactivate lifecycle hook
  // -------------------------------------------------------------------------

  describe('onDeactivate lifecycle hook', () => {
    it('resolves without throwing', async () => {
      const pack = createTopicalityPack({ embeddingFn: mockEmbeddingFn });

      await expect(pack.onDeactivate!()).resolves.toBeUndefined();
    });

    it('clears the guardrail drift tracker sessions on deactivate', async () => {
      const pack = createTopicalityPack({
        allowedTopics: [BILLING_TOPIC],
        enableDriftDetection: true,
        embeddingFn: mockEmbeddingFn,
      });

      const guardrail = pack.descriptors.find((d) => d.id === 'topicality-guardrail')!
        .payload as any;

      await guardrail.evaluateInput({
        context: { userId: 'u1', sessionId: 's1' },
        input: { textInput: 'Need help with my invoice' },
      });

      expect(guardrail.driftTracker).toBeTruthy();
      expect(guardrail.driftTracker.sessions.size).toBe(1);

      await expect(pack.onDeactivate!()).resolves.toBeUndefined();
      expect(guardrail.driftTracker.sessions.size).toBe(0);
    });

    it('handles deactivation when drift detection is disabled', async () => {
      const pack = createTopicalityPack({
        enableDriftDetection: false,
        embeddingFn: mockEmbeddingFn,
      });

      // Should not throw even when no drift tracker exists.
      await expect(pack.onDeactivate!()).resolves.toBeUndefined();
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

  it('returns a pack with name "topicality"', () => {
    const context: ExtensionPackContext = {};
    const pack = createExtensionPack(context);

    expect(pack.name).toBe('topicality');
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

  it('bridges context.options to createTopicalityPack', () => {
    const context: ExtensionPackContext = {
      options: {
        allowedTopics: [BILLING_TOPIC],
        embeddingFn: mockEmbeddingFn,
      } as TopicalityPackOptions,
    };

    const pack = createExtensionPack(context);

    // Pack must be well-formed.
    expect(pack.descriptors).toHaveLength(2);
    expect(pack.name).toBe('topicality');
  });

  it('works when context.options is undefined', () => {
    const context: ExtensionPackContext = { options: undefined };
    const pack = createExtensionPack(context);

    expect(pack.name).toBe('topicality');
    expect(pack.descriptors).toHaveLength(2);
  });
});
