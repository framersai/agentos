/**
 * @fileoverview Shared contract test suite for IMemoryArchive implementations.
 *
 * Run against both shared-adapter and standalone-adapter modes of
 * SqlStorageMemoryArchive. Future backends inherit this suite.
 *
 * @module agentos/memory/archive/__tests__/IMemoryArchive.contract.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IMemoryArchive, ArchivedTrace } from '../IMemoryArchive.js';
import { sha256 } from '../../core/util/crossPlatformCrypto.js';

/**
 * Create a valid ArchivedTrace with sensible defaults.
 * Override any field via the `overrides` parameter.
 *
 * @param overrides - Partial fields to override on the default trace.
 * @returns A complete ArchivedTrace ready for `store()`.
 */
function makeTrace(overrides: Partial<ArchivedTrace> = {}): ArchivedTrace {
  return {
    traceId: overrides.traceId ?? 'trace_001',
    agentId: overrides.agentId ?? 'agent_test',
    verbatimContent: overrides.verbatimContent ?? 'The dragon attacked the village at dawn.',
    contentHash: overrides.contentHash ?? '',
    traceType: overrides.traceType ?? 'episodic',
    emotionalContext: overrides.emotionalContext ?? {
      valence: -0.5, arousal: 0.8, dominance: -0.3, intensity: 0.4, gmiMood: 'anxious',
    },
    entities: overrides.entities ?? ['dragon', 'village'],
    tags: overrides.tags ?? ['combat', 'world_event'],
    createdAt: overrides.createdAt ?? Date.now() - 86_400_000 * 90,
    archivedAt: overrides.archivedAt ?? Date.now(),
    archiveReason: overrides.archiveReason ?? 'temporal_gist',
  };
}

/**
 * Run the full IMemoryArchive contract suite against a given archive factory.
 *
 * @param createArchive - Factory that returns an initialized archive and a cleanup function.
 */
export function runArchiveContractSuite(
  createArchive: () => Promise<{ archive: IMemoryArchive; cleanup: () => Promise<void> }>,
) {
  let archive: IMemoryArchive;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const result = await createArchive();
    archive = result.archive;
    cleanup = result.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('store-then-rehydrate round trip preserves verbatim content', async () => {
    const trace = makeTrace();
    trace.contentHash = await sha256(trace.verbatimContent);

    const writeResult = await archive.store(trace);
    expect(writeResult.success).toBe(true);
    expect(writeResult.traceId).toBe('trace_001');
    expect(writeResult.bytesWritten).toBeGreaterThan(0);

    const rehydrated = await archive.rehydrate('trace_001');
    expect(rehydrated).not.toBeNull();
    expect(rehydrated!.verbatimContent).toBe(trace.verbatimContent);
    expect(rehydrated!.contentHash).toBe(trace.contentHash);
    expect(rehydrated!.archiveReason).toBe('temporal_gist');
  });

  it('store is idempotent on same trace id', async () => {
    const trace = makeTrace();
    trace.contentHash = await sha256(trace.verbatimContent);

    await archive.store(trace);
    const second = await archive.store(trace);
    expect(second.success).toBe(true);
    expect(second.bytesWritten).toBe(0);

    const list = await archive.list({ agentId: 'agent_test' });
    expect(list).toHaveLength(1);
  });

  it('rehydrate returns null for unknown trace id', async () => {
    const result = await archive.rehydrate('nonexistent_trace');
    expect(result).toBeNull();
  });

  it('rehydrate returns null on content hash mismatch', async () => {
    const trace = makeTrace({ contentHash: 'wrong_hash_on_purpose' });
    await archive.store(trace);

    const result = await archive.rehydrate('trace_001');
    expect(result).toBeNull();
  });

  it('drop removes archived content', async () => {
    const trace = makeTrace();
    trace.contentHash = await sha256(trace.verbatimContent);
    await archive.store(trace);

    await archive.drop('trace_001');
    const result = await archive.rehydrate('trace_001');
    expect(result).toBeNull();
  });

  it('drop is no-op for unknown trace id', async () => {
    await expect(archive.drop('nonexistent')).resolves.not.toThrow();
  });

  it('list filters by agentId', async () => {
    const t1 = makeTrace({ traceId: 't1', agentId: 'agent_a' });
    t1.contentHash = await sha256(t1.verbatimContent);
    const t2 = makeTrace({ traceId: 't2', agentId: 'agent_b' });
    t2.contentHash = await sha256(t2.verbatimContent);

    await archive.store(t1);
    await archive.store(t2);

    const listA = await archive.list({ agentId: 'agent_a' });
    expect(listA).toHaveLength(1);
    expect(listA[0].traceId).toBe('t1');
  });

  it('list filters by olderThanMs', async () => {
    const old = makeTrace({ traceId: 'old', archivedAt: Date.now() - 86_400_000 * 400 });
    old.contentHash = await sha256(old.verbatimContent);
    const recent = makeTrace({ traceId: 'recent', archivedAt: Date.now() - 1000 });
    recent.contentHash = await sha256(recent.verbatimContent);

    await archive.store(old);
    await archive.store(recent);

    const staleList = await archive.list({ olderThanMs: 86_400_000 * 365 });
    expect(staleList).toHaveLength(1);
    expect(staleList[0].traceId).toBe('old');
  });

  it('list respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      const t = makeTrace({ traceId: `t${i}` });
      t.contentHash = await sha256(t.verbatimContent);
      await archive.store(t);
    }
    const limited = await archive.list({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('rehydrate writes access log entry', async () => {
    const trace = makeTrace();
    trace.contentHash = await sha256(trace.verbatimContent);
    await archive.store(trace);

    const beforeAccess = await archive.lastAccessedAt('trace_001');
    expect(beforeAccess).toBeNull();

    await archive.rehydrate('trace_001', 'test_context');

    const afterAccess = await archive.lastAccessedAt('trace_001');
    expect(afterAccess).not.toBeNull();
    expect(afterAccess).toBeGreaterThan(0);
  });

  it('drop cleans up access log entries', async () => {
    const trace = makeTrace();
    trace.contentHash = await sha256(trace.verbatimContent);
    await archive.store(trace);
    await archive.rehydrate('trace_001');

    const beforeDrop = await archive.lastAccessedAt('trace_001');
    expect(beforeDrop).not.toBeNull();

    await archive.drop('trace_001');

    const afterDrop = await archive.lastAccessedAt('trace_001');
    expect(afterDrop).toBeNull();
  });
}
