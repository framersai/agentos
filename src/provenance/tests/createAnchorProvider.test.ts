/**
 * @file createAnchorProvider.test.ts
 * @description Unit tests for the anchor provider factory, registry pattern,
 * NoneProvider, and CompositeAnchorProvider.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAnchorProvider, registerAnchorProviderFactory } from '../anchoring/providers/createAnchorProvider.js';
import { NoneProvider } from '../anchoring/providers/NoneProvider.js';
import { CompositeAnchorProvider } from '../anchoring/providers/CompositeAnchorProvider.js';
import type { AnchorProvider, AnchorRecord, AnchorProviderResult, ProofLevel } from '../types.js';

// =============================================================================
// Helpers
// =============================================================================

function createMockAnchor(overrides?: Partial<AnchorRecord>): AnchorRecord {
  return {
    id: 'anchor-test-001',
    merkleRoot: 'abc123def456',
    sequenceFrom: 1,
    sequenceTo: 10,
    eventCount: 10,
    timestamp: '2025-01-15T00:00:00.000Z',
    signature: 'mock-signature-base64',
    ...overrides,
  };
}

function createStubProvider(
  id: string,
  proofLevel: ProofLevel,
  publishResult?: Partial<AnchorProviderResult>,
): AnchorProvider {
  return {
    id,
    name: `Stub ${id}`,
    proofLevel,
    publish: vi.fn().mockResolvedValue({
      providerId: id,
      success: true,
      ...publishResult,
    }),
    verify: vi.fn().mockResolvedValue(true),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

// =============================================================================
// NoneProvider
// =============================================================================

describe('NoneProvider', () => {
  it('should have correct identity', () => {
    const p = new NoneProvider();
    expect(p.id).toBe('none');
    expect(p.name).toBe('None (Local Only)');
    expect(p.proofLevel).toBe('verifiable');
  });

  it('should return success from publish() without externalRef', async () => {
    const p = new NoneProvider();
    const result = await p.publish(createMockAnchor());
    expect(result.success).toBe(true);
    expect(result.providerId).toBe('none');
    expect(result.externalRef).toBeUndefined();
  });
});

// =============================================================================
// CompositeAnchorProvider
// =============================================================================

describe('CompositeAnchorProvider', () => {
  it('should have correct identity', () => {
    const providers = [
      createStubProvider('a', 'externally-archived'),
      createStubProvider('b', 'publicly-auditable'),
    ];
    const composite = new CompositeAnchorProvider(providers);
    expect(composite.id).toBe('composite');
    expect(composite.name).toBe('Composite Provider');
  });

  it('should return highest proof level among children', () => {
    const providers = [
      createStubProvider('a', 'verifiable'),
      createStubProvider('b', 'publicly-timestamped'),
      createStubProvider('c', 'externally-archived'),
    ];
    const composite = new CompositeAnchorProvider(providers);
    expect(composite.proofLevel).toBe('publicly-timestamped');
  });

  it('should return verifiable when only verifiable children', () => {
    const providers = [
      createStubProvider('a', 'verifiable'),
      createStubProvider('b', 'verifiable'),
    ];
    const composite = new CompositeAnchorProvider(providers);
    expect(composite.proofLevel).toBe('verifiable');
  });

  it('should publish to all children in parallel', async () => {
    const providerA = createStubProvider('a', 'externally-archived', {
      externalRef: 's3://bucket/a',
    });
    const providerB = createStubProvider('b', 'publicly-auditable', {
      externalRef: 'rekor:12345',
    });

    const composite = new CompositeAnchorProvider([providerA, providerB]);
    const result = await composite.publish(createMockAnchor());

    expect(result.providerId).toBe('composite');
    expect(result.success).toBe(true);
    expect(providerA.publish).toHaveBeenCalledTimes(1);
    expect(providerB.publish).toHaveBeenCalledTimes(1);
  });

  it('should return first successful externalRef', async () => {
    const providerA = createStubProvider('a', 'externally-archived', {
      externalRef: 's3://bucket/first',
    });
    const providerB = createStubProvider('b', 'publicly-auditable', {
      externalRef: 'rekor:second',
    });

    const composite = new CompositeAnchorProvider([providerA, providerB]);
    const result = await composite.publish(createMockAnchor());

    expect(result.externalRef).toBe('s3://bucket/first');
  });

  it('should handle partial failures', async () => {
    const providerA = createStubProvider('a', 'externally-archived');
    (providerA.publish as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('S3 down'));

    const providerB = createStubProvider('b', 'publicly-auditable', {
      externalRef: 'rekor:abc',
    });

    const composite = new CompositeAnchorProvider([providerA, providerB]);
    const result = await composite.publish(createMockAnchor());

    expect(result.success).toBe(true);
    expect(result.externalRef).toBe('rekor:abc');
  });

  it('should report overall failure when all children fail', async () => {
    const providerA = createStubProvider('a', 'externally-archived');
    (providerA.publish as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('S3 down'));

    const providerB = createStubProvider('b', 'publicly-auditable');
    (providerB.publish as ReturnType<typeof vi.fn>).mockResolvedValue({
      providerId: 'b',
      success: false,
      error: 'Rekor unavailable',
    });

    const composite = new CompositeAnchorProvider([providerA, providerB]);
    const result = await composite.publish(createMockAnchor());

    expect(result.success).toBe(false);
  });

  it('should include per-provider results in metadata', async () => {
    const providerA = createStubProvider('a', 'externally-archived', {
      externalRef: 's3://bucket/key',
    });
    const providerB = createStubProvider('b', 'publicly-auditable', {
      externalRef: 'rekor:idx',
    });

    const composite = new CompositeAnchorProvider([providerA, providerB]);
    const result = await composite.publish(createMockAnchor());

    const meta = result.metadata as { providerResults: AnchorProviderResult[] };
    expect(meta.providerResults).toHaveLength(2);
    expect(meta.providerResults[0].providerId).toBe('a');
    expect(meta.providerResults[1].providerId).toBe('b');
  });

  it('should verify against all children that support verify', async () => {
    const providerA = createStubProvider('a', 'externally-archived');
    const providerB = createStubProvider('b', 'publicly-auditable');

    const composite = new CompositeAnchorProvider([providerA, providerB]);
    const valid = await composite.verify!(createMockAnchor());

    expect(valid).toBe(true);
    expect(providerA.verify).toHaveBeenCalled();
    expect(providerB.verify).toHaveBeenCalled();
  });

  it('should return false from verify when any child fails', async () => {
    const providerA = createStubProvider('a', 'externally-archived');
    const providerB = createStubProvider('b', 'publicly-auditable');
    (providerB.verify as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const composite = new CompositeAnchorProvider([providerA, providerB]);
    const valid = await composite.verify!(createMockAnchor());

    expect(valid).toBe(false);
  });

  it('should dispose all children', async () => {
    const providerA = createStubProvider('a', 'externally-archived');
    const providerB = createStubProvider('b', 'publicly-auditable');

    const composite = new CompositeAnchorProvider([providerA, providerB]);
    await composite.dispose!();

    expect(providerA.dispose).toHaveBeenCalledTimes(1);
    expect(providerB.dispose).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// createAnchorProvider factory
// =============================================================================

describe('createAnchorProvider', () => {
  it('should return NoneProvider when target is undefined', () => {
    const provider = createAnchorProvider();
    expect(provider).toBeInstanceOf(NoneProvider);
  });

  it('should return NoneProvider when target type is "none"', () => {
    const provider = createAnchorProvider({ type: 'none' });
    expect(provider).toBeInstanceOf(NoneProvider);
  });

  it('should return NoneProvider for unknown type with warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = createAnchorProvider({ type: 'unknown-type' as any });
    expect(provider).toBeInstanceOf(NoneProvider);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No provider registered for type "unknown-type"'),
    );
    warnSpy.mockRestore();
  });

  it('should return NoneProvider for "custom" type with warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = createAnchorProvider({ type: 'custom' });
    expect(provider).toBeInstanceOf(NoneProvider);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Custom provider type requires direct injection'),
    );
    warnSpy.mockRestore();
  });

  it('should create CompositeAnchorProvider for "composite" type', () => {
    const provider = createAnchorProvider({
      type: 'composite',
      targets: [{ type: 'none' }, { type: 'none' }],
    });
    expect(provider).toBeInstanceOf(CompositeAnchorProvider);
  });

  it('should return NoneProvider for "composite" with empty targets', () => {
    const provider = createAnchorProvider({ type: 'composite', targets: [] });
    expect(provider).toBeInstanceOf(NoneProvider);
  });

  it('should return NoneProvider for "composite" with undefined targets', () => {
    const provider = createAnchorProvider({ type: 'composite' });
    expect(provider).toBeInstanceOf(NoneProvider);
  });
});

// =============================================================================
// registerAnchorProviderFactory
// =============================================================================

describe('registerAnchorProviderFactory', () => {
  it('should register a factory that createAnchorProvider can resolve', () => {
    const stubProvider = createStubProvider('test-provider', 'externally-archived');
    registerAnchorProviderFactory('test-provider', () => stubProvider);

    const provider = createAnchorProvider({ type: 'test-provider' as any });
    expect(provider).toBe(stubProvider);
  });

  it('should pass options to the factory function', () => {
    const factory = vi.fn().mockReturnValue(
      createStubProvider('opts-test', 'publicly-auditable'),
    );
    registerAnchorProviderFactory('opts-test', factory);

    createAnchorProvider({
      type: 'opts-test' as any,
      options: { serverUrl: 'https://example.com', timeout: 5000 },
    });

    expect(factory).toHaveBeenCalledWith({ serverUrl: 'https://example.com', timeout: 5000 });
  });

  it('should allow overriding a registered factory', () => {
    const first = createStubProvider('override-test-1', 'verifiable');
    const second = createStubProvider('override-test-2', 'publicly-timestamped');

    registerAnchorProviderFactory('override-type', () => first);
    registerAnchorProviderFactory('override-type', () => second);

    const provider = createAnchorProvider({ type: 'override-type' as any });
    expect(provider.id).toBe('override-test-2');
  });

  it('should work within composite targets', () => {
    const stubA = createStubProvider('comp-a', 'externally-archived');
    const stubB = createStubProvider('comp-b', 'publicly-auditable');

    registerAnchorProviderFactory('comp-a', () => stubA);
    registerAnchorProviderFactory('comp-b', () => stubB);

    const provider = createAnchorProvider({
      type: 'composite',
      targets: [
        { type: 'comp-a' as any },
        { type: 'comp-b' as any },
      ],
    });

    expect(provider).toBeInstanceOf(CompositeAnchorProvider);
    expect(provider.proofLevel).toBe('publicly-auditable');
  });
});
