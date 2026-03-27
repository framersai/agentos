/**
 * @fileoverview Tests for RetrievalFeedbackSignal and DecayModel.penalizeUnused().
 *
 * Covers:
 * - penalizeUnused: halves stability, applies 10% strength penalty, respects 60 s floor.
 * - RetrievalFeedbackSignal.detect: keyword-based used/ignored classification.
 * - RetrievalFeedbackSignal persistence: rows written to retrieval_feedback table.
 * - RetrievalFeedbackSignal trace updates: used signals reinforce, ignored signals penalise.
 * - RetrievalFeedbackSignal.getHistory: returns events ordered most-recent first.
 * - RetrievalFeedbackSignal.getStats: correct used/ignored aggregate counts.
 *
 * @module agentos/memory/feedback/__tests__/feedback.test
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { penalizeUnused, computeCurrentStrength } from '../../decay/DecayModel.js';
import { RetrievalFeedbackSignal } from '../RetrievalFeedbackSignal.js';
import { SqliteBrain } from '../../store/SqliteBrain.js';
import type { MemoryTrace } from '../../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Unique temp path for each test brain. */
function tempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `agentos-feedback-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
}

/** Registry of brains opened during a test run so afterEach can clean up. */
const openBrains: Array<{ brain: SqliteBrain; dbPath: string }> = [];

async function openBrain(dbPath?: string): Promise<{ brain: SqliteBrain; dbPath: string }> {
  const p = dbPath ?? tempDbPath();
  const brain = await SqliteBrain.open(p);
  openBrains.push({ brain, dbPath: p });
  return { brain, dbPath: p };
}

afterEach(async () => {
  while (openBrains.length > 0) {
    const entry = openBrains.pop()!;
    try {
      await entry.brain.close();
    } catch {
      // Already closed.
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const p = entry.dbPath + suffix;
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // Best-effort cleanup.
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid `MemoryTrace` mock.
 * Only fields required by `penalizeUnused` / `computeCurrentStrength` and the
 * `retrieval_feedback` FK constraint are set explicitly; everything else is
 * given safe defaults.
 */
function makeTrace(overrides: Partial<MemoryTrace> = {}): MemoryTrace {
  const now = Date.now();
  return {
    id: `trace-${Math.random().toString(36).slice(2)}`,
    type: 'episodic',
    scope: 'thread',
    scopeId: 'thread-1',
    content: 'Default trace content for testing purposes only.',
    entities: [],
    tags: [],
    provenance: {
      sourceType: 'user_statement',
      sourceTimestamp: now,
      confidence: 0.9,
      verificationCount: 0,
    },
    emotionalContext: {
      valence: 0,
      arousal: 0,
      dominance: 0,
      intensity: 0,
      gmiMood: 'neutral',
    },
    encodingStrength: 0.8,
    stability: 3_600_000, // 1 hour
    retrievalCount: 0,
    lastAccessedAt: now,
    accessCount: 0,
    reinforcementInterval: 86_400_000,
    associatedTraceIds: [],
    createdAt: now,
    updatedAt: now,
    isActive: true,
    ...overrides,
  };
}

/**
 * Insert a minimal memory_traces row so the `retrieval_feedback` FK
 * constraint is satisfied.  Only columns that have no DEFAULT are provided.
 */
async function seedTraceRow(brain: SqliteBrain, trace: MemoryTrace): Promise<void> {
  await brain.run(
    `INSERT OR IGNORE INTO memory_traces
       (id, type, scope, content, strength, created_at, tags, emotions, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      trace.id,
      trace.type,
      trace.scope,
      trace.content,
      trace.encodingStrength,
      trace.createdAt,
      JSON.stringify(trace.tags),
      JSON.stringify(trace.emotionalContext),
      '{}',
    ],
  );
}

// ---------------------------------------------------------------------------
// DecayModel.penalizeUnused
// ---------------------------------------------------------------------------

describe('penalizeUnused', () => {
  it('halves stability of a normal trace', () => {
    const trace = makeTrace({ stability: 3_600_000 });
    const now = trace.lastAccessedAt;
    const result = penalizeUnused(trace, now);

    expect(result.stability).toBeCloseTo(1_800_000);
  });

  it('applies a 10% immediate strength penalty relative to current strength', () => {
    const trace = makeTrace({ encodingStrength: 1.0, stability: 3_600_000 });
    const now = trace.lastAccessedAt;

    // At t=0, computeCurrentStrength returns encodingStrength * e^0 = encodingStrength.
    const expectedCurrentStrength = computeCurrentStrength(trace, now);
    const result = penalizeUnused(trace, now);

    expect(result.encodingStrength).toBeCloseTo(expectedCurrentStrength * 0.9, 6);
  });

  it('floors stability at 60 000 ms (1 minute) when stability is already very low', () => {
    // stability = 80 000 ms → half would be 40 000 ms which is below the floor.
    const trace = makeTrace({ stability: 80_000 });
    const now = trace.lastAccessedAt;
    const result = penalizeUnused(trace, now);

    expect(result.stability).toBe(60_000);
  });

  it('does not apply the floor when halved stability is above 60 000 ms', () => {
    const trace = makeTrace({ stability: 200_000 });
    const now = trace.lastAccessedAt;
    const result = penalizeUnused(trace, now);

    // 200 000 / 2 = 100 000 — above floor.
    expect(result.stability).toBeCloseTo(100_000);
  });

  it('sets lastAccessedAt to the provided now timestamp', () => {
    const trace = makeTrace();
    const now = Date.now() + 5_000;
    const result = penalizeUnused(trace, now);

    expect(result.lastAccessedAt).toBe(now);
  });
});

// ---------------------------------------------------------------------------
// RetrievalFeedbackSignal.detect
// ---------------------------------------------------------------------------

describe('RetrievalFeedbackSignal.detect', () => {
  it('marks a trace as "used" when its keywords appear in the response', async () => {
    const { brain } = await openBrain();
    const signal = new RetrievalFeedbackSignal(brain);

    const trace = makeTrace({
      content: 'React development with TypeScript components and hooks',
    });
    await seedTraceRow(brain, trace);

    const response =
      'React development is a modern approach to building user interfaces. ' +
      'TypeScript components bring type safety and hooks make state management clean.';

    const feedbacks = await signal.detect([trace], response);

    expect(feedbacks).toHaveLength(1);
    expect(feedbacks[0].traceId).toBe(trace.id);
    expect(feedbacks[0].signal).toBe('used');
  });

  it('marks a trace as "ignored" when its keywords do not appear in the response', async () => {
    const { brain } = await openBrain();
    const sig = new RetrievalFeedbackSignal(brain);

    const trace = makeTrace({
      content: 'Python programming language with machine learning algorithms and neural networks',
    });
    await seedTraceRow(brain, trace);

    // Response is about cooking — completely unrelated.
    const response =
      'To make a great risotto, start with quality arborio rice and stir frequently. ' +
      'Add warm broth gradually and finish with butter and parmesan cheese.';

    const feedbacks = await sig.detect([trace], response);

    expect(feedbacks).toHaveLength(1);
    expect(feedbacks[0].signal).toBe('ignored');
  });

  it('handles multiple traces in a single detect call', async () => {
    const { brain } = await openBrain();
    const sig = new RetrievalFeedbackSignal(brain);

    const usedTrace = makeTrace({
      content: 'GraphQL queries with fragments provide efficient schema traversal',
    });
    const ignoredTrace = makeTrace({
      content: 'Knitting patterns using yarns and circular needles for comfortable scarves',
    });

    await seedTraceRow(brain, usedTrace);
    await seedTraceRow(brain, ignoredTrace);

    const response =
      'GraphQL queries allow you to request exactly the data you need. Fragments provide ' +
      'reusable selections across multiple schema types for efficient traversal.';

    const feedbacks = await sig.detect([usedTrace, ignoredTrace], response);

    expect(feedbacks).toHaveLength(2);

    const usedFeedback = feedbacks.find((f) => f.traceId === usedTrace.id);
    const ignoredFeedback = feedbacks.find((f) => f.traceId === ignoredTrace.id);

    expect(usedFeedback?.signal).toBe('used');
    expect(ignoredFeedback?.signal).toBe('ignored');
  });

  it('returns an empty array when no traces are injected', async () => {
    const { brain } = await openBrain();
    const sig = new RetrievalFeedbackSignal(brain);

    const feedbacks = await sig.detect([], 'Some LLM response text here.');
    expect(feedbacks).toHaveLength(0);
  });

  it('treats traces with no qualifying keywords (all ≤ 4 chars) as ignored', async () => {
    const { brain } = await openBrain();
    const sig = new RetrievalFeedbackSignal(brain);

    // All words are ≤ 4 characters — no keywords to match.
    const trace = makeTrace({ content: 'I am the one who ran far away' });
    await seedTraceRow(brain, trace);

    const feedbacks = await sig.detect([trace], 'I am the one who ran far away');
    expect(feedbacks[0].signal).toBe('ignored');
  });
});

// ---------------------------------------------------------------------------
// RetrievalFeedbackSignal — persistence
// ---------------------------------------------------------------------------

describe('RetrievalFeedbackSignal persistence', () => {
  it('writes a row to retrieval_feedback for each injected trace', async () => {
    const { brain } = await openBrain();
    const sig = new RetrievalFeedbackSignal(brain);

    const traceA = makeTrace({ content: 'distributed systems architecture with microservices' });
    const traceB = makeTrace({ content: 'quantum entanglement experiments in particle physics' });

    await seedTraceRow(brain, traceA);
    await seedTraceRow(brain, traceB);

    await sig.detect(
      [traceA, traceB],
      'Distributed systems often rely on microservices to scale independently.',
    );

    interface CountRow { total: number }
    const row = await brain.get<CountRow>(
      'SELECT COUNT(*) AS total FROM retrieval_feedback',
    );

    expect(row?.total).toBe(2);
  });

  it('persists the correct signal value for each trace', async () => {
    const { brain } = await openBrain();
    const sig = new RetrievalFeedbackSignal(brain);

    const usedTrace = makeTrace({
      content: 'containerisation using docker images kubernetes deployments',
    });
    const ignoredTrace = makeTrace({
      content: 'watercolour painting techniques with transparent glazing layers',
    });

    await seedTraceRow(brain, usedTrace);
    await seedTraceRow(brain, ignoredTrace);

    await sig.detect(
      [usedTrace, ignoredTrace],
      'Containerisation with Docker images simplifies deployments across Kubernetes clusters.',
    );

    interface SignalRow { trace_id: string; signal: string }
    const rows = await brain.all<SignalRow>(
      'SELECT trace_id, signal FROM retrieval_feedback ORDER BY id',
    );

    const byId = new Map(rows.map((r) => [r.trace_id, r.signal]));
    expect(byId.get(usedTrace.id)).toBe('used');
    expect(byId.get(ignoredTrace.id)).toBe('ignored');
  });

  it('reinforces the stored trace when the signal is "used"', async () => {
    const { brain } = await openBrain();
    const sig = new RetrievalFeedbackSignal(brain);

    const trace = makeTrace({
      content: 'distributed tracing telemetry observability services',
      encodingStrength: 0.8,
      retrievalCount: 0,
    });
    await seedTraceRow(brain, trace);

    await sig.detect(
      [trace],
      'Distributed tracing improves observability across services and telemetry pipelines.',
    );

    interface TraceStateRow {
      strength: number;
      last_accessed: number | null;
      retrieval_count: number;
    }

    const row = await brain.get<TraceStateRow>(
      `SELECT strength, last_accessed, retrieval_count
       FROM memory_traces
       WHERE id = ?`,
      [trace.id],
    );

    expect(row?.strength ?? 0).toBeGreaterThan(trace.encodingStrength);
    expect(row?.retrieval_count).toBe(1);
    expect(row?.last_accessed ?? 0).toBeGreaterThanOrEqual(trace.createdAt);
  });

  it('penalises the stored trace when the signal is "ignored"', async () => {
    const { brain } = await openBrain();
    const sig = new RetrievalFeedbackSignal(brain);

    const trace = makeTrace({
      content: 'watercolour glazing paper pigments composition',
      encodingStrength: 1.0,
      retrievalCount: 0,
    });
    await seedTraceRow(brain, trace);

    await sig.detect(
      [trace],
      'PostgreSQL replicas improve read throughput for database-heavy services.',
    );

    interface TraceStateRow {
      strength: number;
      last_accessed: number | null;
      retrieval_count: number;
    }

    const row = await brain.get<TraceStateRow>(
      `SELECT strength, last_accessed, retrieval_count
       FROM memory_traces
       WHERE id = ?`,
      [trace.id],
    );

    expect(row?.strength ?? 1).toBeLessThan(trace.encodingStrength);
    expect(row?.retrieval_count).toBe(0);
    expect(row?.last_accessed ?? 0).toBeGreaterThanOrEqual(trace.createdAt);
  });
});

// ---------------------------------------------------------------------------
// RetrievalFeedbackSignal.getHistory
// ---------------------------------------------------------------------------

describe('RetrievalFeedbackSignal.getHistory', () => {
  it('returns feedback events for the correct trace', async () => {
    const { brain } = await openBrain();
    const sig = new RetrievalFeedbackSignal(brain);

    const trace = makeTrace({ content: 'serverless functions with event driven architecture' });
    await seedTraceRow(brain, trace);

    await sig.detect([trace], 'serverless functions are ideal for event driven architecture.');
    await sig.detect([trace], 'completely unrelated topic about cooking pasta dishes.');

    const history = await sig.getHistory(trace.id);
    expect(history).toHaveLength(2);
    expect(history.every((h) => h.traceId === trace.id)).toBe(true);
  });

  it('returns history ordered most-recent first', async () => {
    const { brain } = await openBrain();
    const sig = new RetrievalFeedbackSignal(brain);

    const trace = makeTrace({ content: 'neural networks machine learning training algorithms' });
    await seedTraceRow(brain, trace);

    // First call → 'used'
    await sig.detect([trace], 'neural networks use training algorithms to optimise machine learning models.');
    // Second call → 'ignored' (unrelated)
    await sig.detect([trace], 'fresh bread tastes great with butter and olive oil.');

    const history = await sig.getHistory(trace.id);

    // Most-recent first → the 'ignored' event (second detect) comes first.
    expect(history[0].signal).toBe('ignored');
    expect(history[1].signal).toBe('used');
  });

  it('respects the limit parameter', async () => {
    const { brain } = await openBrain();
    const sig = new RetrievalFeedbackSignal(brain);

    const trace = makeTrace({ content: 'event sourcing domain driven design aggregate roots' });
    await seedTraceRow(brain, trace);

    for (let i = 0; i < 5; i++) {
      await sig.detect([trace], 'event sourcing uses domain driven design with aggregate roots.');
    }

    const limited = await sig.getHistory(trace.id, 3);
    expect(limited).toHaveLength(3);
  });

  it('returns empty array for a trace with no feedback history', async () => {
    const { brain } = await openBrain();
    const sig = new RetrievalFeedbackSignal(brain);

    const history = await sig.getHistory('nonexistent-trace-id');
    expect(history).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// RetrievalFeedbackSignal.getStats
// ---------------------------------------------------------------------------

describe('RetrievalFeedbackSignal.getStats', () => {
  it('returns correct used and ignored counts after mixed signals', async () => {
    const { brain } = await openBrain();
    const sig = new RetrievalFeedbackSignal(brain);

    const trace = makeTrace({
      content: 'progressive web applications service workers offline caching',
    });
    await seedTraceRow(brain, trace);

    // 2 used signals
    const usedResponse =
      'Progressive web applications use service workers for offline caching functionality.';
    await sig.detect([trace], usedResponse);
    await sig.detect([trace], usedResponse);

    // 3 ignored signals
    const ignoredResponse = 'Today is a sunny day, perfect for a walk in the park.';
    await sig.detect([trace], ignoredResponse);
    await sig.detect([trace], ignoredResponse);
    await sig.detect([trace], ignoredResponse);

    const stats = await sig.getStats(trace.id);
    expect(stats.used).toBe(2);
    expect(stats.ignored).toBe(3);
  });

  it('returns zero counts for a trace with no feedback', async () => {
    const { brain } = await openBrain();
    const sig = new RetrievalFeedbackSignal(brain);

    const stats = await sig.getStats('no-feedback-trace');
    expect(stats.used).toBe(0);
    expect(stats.ignored).toBe(0);
  });

  it('counts all signals as "used" when every detect call matches', async () => {
    const { brain } = await openBrain();
    const sig = new RetrievalFeedbackSignal(brain);

    const trace = makeTrace({
      content: 'typescript generics conditional types mapped inference',
    });
    await seedTraceRow(brain, trace);

    const response =
      'TypeScript generics enable powerful conditional types and mapped inference patterns.';
    await sig.detect([trace], response);
    await sig.detect([trace], response);

    const stats = await sig.getStats(trace.id);
    expect(stats.used).toBe(2);
    expect(stats.ignored).toBe(0);
  });
});
