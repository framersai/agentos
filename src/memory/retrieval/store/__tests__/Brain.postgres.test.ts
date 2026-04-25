/**
 * @fileoverview Postgres integration tests for `Brain.openPostgres`.
 *
 * Gated on `AGENTOS_TEST_POSTGRES_URL` — when the env var is absent, every
 * test is skipped so the suite stays green for contributors without a local
 * Postgres. CI provides the env var via the `pgvector/pgvector:pg16`
 * service container declared in `.github/workflows/ci.yml`.
 *
 * Each test uses a unique `brainId` (Date.now + random suffix) so concurrent
 * runs and re-runs of this file don't collide on shared schema. The
 * `afterEach` cleanup wipes every brain-owned table for the test brainId so
 * the database stays clean for subsequent runs.
 *
 * @module memory/retrieval/store/__tests__/Brain.postgres.test
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Brain } from '../Brain.js';
import { PORTABLE_TABLES } from '../portable-tables.js';

const POSTGRES_URL = process.env.AGENTOS_TEST_POSTGRES_URL;
const describeIfPostgres = POSTGRES_URL ? describe : describe.skip;

function uniqueBrainId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanup(brain: Brain): Promise<void> {
  // Order matters: child tables before parents to satisfy FKs.
  for (const table of [...PORTABLE_TABLES].reverse()) {
    try {
      await brain.run(`DELETE FROM ${table} WHERE brain_id = ?`, [brain.brainId]);
    } catch {
      // Table may not exist on first run; ignore.
    }
  }
}

describeIfPostgres('Brain.openPostgres', () => {
  const openedBrains: Brain[] = [];

  afterEach(async () => {
    while (openedBrains.length > 0) {
      const brain = openedBrains.pop()!;
      try {
        await cleanup(brain);
      } catch {
        // Best-effort.
      }
      try {
        await brain.close();
      } catch {
        // Best-effort.
      }
    }
  });

  it('opens a Brain backed by Postgres and accepts brainId scoping', async () => {
    const brainId = uniqueBrainId();
    const brain = await Brain.openPostgres(POSTGRES_URL!, { brainId });
    openedBrains.push(brain);

    expect(brain.brainId).toBe(brainId);

    // Schema initialised; brain_meta seeded.
    const ver = await brain.getMeta('schema_version');
    expect(ver).toBe('2');
  });

  it('throws when brainId is missing', async () => {
    await expect(
      Brain.openPostgres(POSTGRES_URL!, {} as { brainId: string }),
    ).rejects.toThrow(/brainId is required/i);
  });

  it('writes and reads memory traces scoped by brain_id', async () => {
    const brainId = uniqueBrainId();
    const brain = await Brain.openPostgres(POSTGRES_URL!, { brainId });
    openedBrains.push(brain);

    await brain.run(
      `INSERT INTO memory_traces (brain_id, id, type, scope, content, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
      [brainId, 'pg-t1', 'episodic', 'user', 'hello postgres', Date.now()],
    );

    const rows = await brain.all<{ id: string; content: string }>(
      `SELECT id, content FROM memory_traces WHERE brain_id = $1`,
      [brainId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'pg-t1', content: 'hello postgres' });
  });

  it('two brains in the same Postgres database stay isolated', async () => {
    const brainAId = uniqueBrainId();
    const brainBId = uniqueBrainId();
    const brainA = await Brain.openPostgres(POSTGRES_URL!, { brainId: brainAId });
    const brainB = await Brain.openPostgres(POSTGRES_URL!, { brainId: brainBId });
    openedBrains.push(brainA, brainB);

    await brainA.run(
      `INSERT INTO memory_traces (brain_id, id, type, scope, content, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
      [brainAId, 'isolated-a', 'episodic', 'user', 'A-only', Date.now()],
    );
    await brainB.run(
      `INSERT INTO memory_traces (brain_id, id, type, scope, content, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
      [brainBId, 'isolated-b', 'episodic', 'user', 'B-only', Date.now()],
    );

    // Each brain's query scoped by its own brainId returns only its own rows.
    const aRows = await brainA.all<{ content: string }>(
      `SELECT content FROM memory_traces WHERE brain_id = $1`,
      [brainAId],
    );
    const bRows = await brainB.all<{ content: string }>(
      `SELECT content FROM memory_traces WHERE brain_id = $1`,
      [brainBId],
    );

    expect(aRows.map((r) => r.content)).toEqual(['A-only']);
    expect(bRows.map((r) => r.content)).toEqual(['B-only']);
  });

  it('migrateV1ToV2 is idempotent on Postgres (re-open is a no-op)', async () => {
    const brainId = uniqueBrainId();

    const brain1 = await Brain.openPostgres(POSTGRES_URL!, { brainId });
    openedBrains.push(brain1);
    expect(await brain1.getMeta('schema_version')).toBe('2');
    await brain1.close();
    openedBrains.pop();

    // Second open should detect v2 and skip migration without error.
    const brain2 = await Brain.openPostgres(POSTGRES_URL!, { brainId });
    openedBrains.push(brain2);
    expect(await brain2.getMeta('schema_version')).toBe('2');
  });
});
