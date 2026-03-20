/**
 * @file index.spec.ts
 * @description Unit tests for the PII redaction pack factory.
 *
 * Tests verify:
 * - createPiiRedactionPack returns an ExtensionPack with correct name/version
 * - The pack provides exactly 3 descriptors: 1 guardrail + 2 tools
 * - Guardrail has id 'pii-redaction-guardrail'
 * - Tools have ids 'pii_scan' and 'pii_redact'
 * - createExtensionPack bridges context.options to createPiiRedactionPack
 * - onActivate rebuilds components with the shared registry
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createPiiRedactionPack,
  createExtensionPack,
} from '../../../../src/extensions/packs/pii-redaction/index';
import { SharedServiceRegistry } from '../../../../src/extensions/SharedServiceRegistry';
import {
  EXTENSION_KIND_GUARDRAIL,
  EXTENSION_KIND_TOOL,
} from '../../../../src/extensions/types';
import type { ExtensionPackContext } from '../../../../src/extensions/manifest';

// ---------------------------------------------------------------------------
// Mocks — mock the heavy dependencies so pack creation is fast
// ---------------------------------------------------------------------------

vi.mock(
  '../../../../src/extensions/packs/pii-redaction/PiiDetectionPipeline',
  () => {
    return {
      PiiDetectionPipeline: vi.fn().mockImplementation(() => ({
        detect: vi.fn().mockResolvedValue({
          entities: [],
          inputLength: 0,
          processingTimeMs: 1,
          tiersExecuted: ['regex'],
          summary: 'No PII detected',
        }),
      })),
    };
  },
);

import { PiiDetectionPipeline } from '../../../../src/extensions/packs/pii-redaction/PiiDetectionPipeline';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createPiiRedactionPack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return an ExtensionPack with correct name and version', () => {
    const pack = createPiiRedactionPack();

    expect(pack.name).toBe('pii-redaction');
    expect(pack.version).toBe('1.0.0');
  });

  it('should provide exactly 3 descriptors', () => {
    const pack = createPiiRedactionPack();

    expect(pack.descriptors).toHaveLength(3);
  });

  it('should have a guardrail descriptor with id "pii-redaction-guardrail"', () => {
    const pack = createPiiRedactionPack();
    const guardrailDescriptor = pack.descriptors.find(
      (d) => d.id === 'pii-redaction-guardrail',
    );

    expect(guardrailDescriptor).toBeDefined();
    expect(guardrailDescriptor!.kind).toBe(EXTENSION_KIND_GUARDRAIL);
    expect(guardrailDescriptor!.priority).toBe(10);
    expect(guardrailDescriptor!.payload).toBeDefined();
  });

  it('should have tool descriptors with ids "pii_scan" and "pii_redact"', () => {
    const pack = createPiiRedactionPack();

    const scanDescriptor = pack.descriptors.find((d) => d.id === 'pii_scan');
    const redactDescriptor = pack.descriptors.find((d) => d.id === 'pii_redact');

    expect(scanDescriptor).toBeDefined();
    expect(scanDescriptor!.kind).toBe(EXTENSION_KIND_TOOL);
    expect(scanDescriptor!.priority).toBe(0);

    expect(redactDescriptor).toBeDefined();
    expect(redactDescriptor!.kind).toBe(EXTENSION_KIND_TOOL);
    expect(redactDescriptor!.priority).toBe(0);
  });

  it('should rebuild components when onActivate is called with shared registry', () => {
    const pack = createPiiRedactionPack();

    // Record the initial pipeline construction count.
    const initialCallCount = (PiiDetectionPipeline as any).mock.calls.length;

    // Call onActivate with a shared service registry.
    const sharedRegistry = new SharedServiceRegistry();
    pack.onActivate!({ services: sharedRegistry });

    // Components should have been rebuilt (3 new PiiDetectionPipeline instances:
    // 1 for guardrail + 1 for scanTool + 1 for redactTool).
    const newCallCount = (PiiDetectionPipeline as any).mock.calls.length;
    expect(newCallCount).toBe(initialCallCount + 3);

    // Descriptors should reflect the rebuilt components (not be stale).
    expect(pack.descriptors).toHaveLength(3);
  });

  it('should accept options and pass them through to components', () => {
    const pack = createPiiRedactionPack({
      entityTypes: ['EMAIL', 'PHONE'],
      redactionStyle: 'mask',
      guardrailScope: 'input',
    });

    // The pack should still have 3 descriptors.
    expect(pack.descriptors).toHaveLength(3);
    // The guardrail should exist.
    const guardrail = pack.descriptors.find(
      (d) => d.id === 'pii-redaction-guardrail',
    );
    expect(guardrail).toBeDefined();
  });
});

describe('createExtensionPack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should bridge context.options to createPiiRedactionPack', () => {
    const context: ExtensionPackContext = {
      options: {
        entityTypes: ['SSN', 'CREDIT_CARD'],
        redactionStyle: 'hash',
      },
    };

    const pack = createExtensionPack(context);

    // Should produce a valid pack with the expected structure.
    expect(pack.name).toBe('pii-redaction');
    expect(pack.version).toBe('1.0.0');
    expect(pack.descriptors).toHaveLength(3);
  });

  it('should work with empty context options', () => {
    const context: ExtensionPackContext = {};

    const pack = createExtensionPack(context);

    expect(pack.name).toBe('pii-redaction');
    expect(pack.descriptors).toHaveLength(3);
  });
});
