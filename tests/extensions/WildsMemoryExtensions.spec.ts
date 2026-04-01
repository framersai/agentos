import { describe, expect, it } from 'vitest';

import { createExtensionPack as createPostgresMemoryPack } from '../../../agentos-extensions/registry/curated/memory/postgres-memory/src/index.ts';
import { createExtensionPack as createRelationshipMemoryPack } from '../../../agentos-extensions/registry/curated/memory/relationship-memory/src/index.ts';

const toolContext = {
  gmiId: 'gmi-1',
  personaId: 'persona-1',
  userContext: {} as any,
};

describe('Wilds memory extensions', () => {
  it('creates a postgres-memory descriptor that stores and queries records', async () => {
    const pack = createPostgresMemoryPack({
      options: { priority: 77 },
      getSecret: () => 'postgres://wilds:test@localhost:5432/wilds',
    });

    expect(pack.descriptors).toHaveLength(1);

    const descriptor = pack.descriptors[0] as any;
    expect(descriptor.kind).toBe('memory-provider');
    expect(descriptor.priority).toBe(77);
    expect(descriptor.payload.supportedTypes).toContain('relational');

    await descriptor.payload.initialize({});
    const traceId = await descriptor.payload.store('companions', {
      type: 'relational',
      content: 'Trust increased after the companion intervened.',
      trustDelta: 8,
    });

    const results = await descriptor.payload.query('companions', {
      query: 'trust increased',
      type: 'relational',
      limit: 5,
    });
    const stats = await descriptor.payload.getStats();

    expect(traceId).toBeTruthy();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: traceId,
      type: 'relational',
    });
    expect(stats).toMatchObject({
      collections: 1,
      documents: 1,
      size: 1,
    });
  });

  it('creates relationship-memory tools that record and recall relationship state', async () => {
    const pack = createRelationshipMemoryPack({
      options: { priority: 61 },
    });

    expect(pack.descriptors).toHaveLength(4);
    expect(pack.descriptors.map((descriptor) => descriptor.id)).toEqual([
      'trust_ledger_query',
      'record_boundary',
      'anchor_moment_recall',
      'intimacy_score',
    ]);

    const recordBoundary = pack.descriptors.find((descriptor) => descriptor.id === 'record_boundary')!;
    const trustLedger = pack.descriptors.find((descriptor) => descriptor.id === 'trust_ledger_query')!;
    const anchorRecall = pack.descriptors.find((descriptor) => descriptor.id === 'anchor_moment_recall')!;
    const intimacyScore = pack.descriptors.find((descriptor) => descriptor.id === 'intimacy_score')!;

    await (recordBoundary.payload as any).execute(
      {
        accountId: 'account-1',
        companionId: 'companion-1',
        eventType: 'trust_event',
        description: 'Companion backed the player in a public dispute.',
        trustDelta: 12,
        intimacyDelta: 4,
        tags: ['loyalty'],
      },
      toolContext,
    );

    await (recordBoundary.payload as any).execute(
      {
        accountId: 'account-1',
        companionId: 'companion-1',
        eventType: 'anchor_moment',
        description: 'Shared a quiet campfire confession.',
        intimacyDelta: 10,
        emotionalValence: 0.9,
        tags: ['campfire', 'confession'],
      },
      toolContext,
    );

    const ledgerResult = await (trustLedger.payload as any).execute(
      {
        accountId: 'account-1',
        companionId: 'companion-1',
        limit: 10,
      },
      toolContext,
    );
    const anchorResult = await (anchorRecall.payload as any).execute(
      {
        accountId: 'account-1',
        companionId: 'companion-1',
        tag: 'campfire',
      },
      toolContext,
    );
    const scoreResult = await (intimacyScore.payload as any).execute(
      {
        accountId: 'account-1',
        companionId: 'companion-1',
      },
      toolContext,
    );

    expect(ledgerResult.success).toBe(true);
    expect(ledgerResult.output.summary.trustScore).toBeGreaterThan(50);
    expect(ledgerResult.output.events).toHaveLength(2);
    expect(anchorResult.output.anchorMoments).toHaveLength(1);
    expect(scoreResult.output.anchorMoments).toBe(1);
    expect(scoreResult.output.intimacyScore).toBeGreaterThan(25);
  });
});
