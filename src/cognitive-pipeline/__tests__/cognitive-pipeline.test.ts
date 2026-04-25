/**
 * @file cognitive-pipeline.test.ts
 * @description Contract tests for CognitivePipeline — top-level
 * orchestrator that composes ingest-router + memory-router + read-router
 * into one pipeline.
 *
 * @module cognitive-pipeline/__tests__/cognitive-pipeline.test
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CognitivePipeline,
  type IngestStage,
  type RecallStage,
  type ReadStage,
} from '../index.js';

interface FakeTrace {
  id: string;
  text: string;
}

interface FakeAnswer {
  answer: string;
  citations: string[];
}

function makeIngestStage(): IngestStage {
  return {
    ingest: vi.fn(async (content: string) => ({
      writtenTraces: 1,
      strategy: 'raw-chunks' as const,
      ingestRouterDecision: { kind: 'short-conversation', strategy: 'raw-chunks', costUsd: 0.0001 },
    })),
  };
}

function makeRecallStage(): RecallStage<FakeTrace> {
  return {
    recall: vi.fn(async (query: string) => ({
      traces: [
        { id: 't1', text: `evidence for ${query}` },
        { id: 't2', text: 'extra context' },
      ],
      backend: 'canonical-hybrid' as const,
      memoryRouterDecision: { category: 'single-session-user', backend: 'canonical-hybrid', costUsd: 0.0191 },
    })),
  };
}

function makeReadStage(): ReadStage<FakeTrace, FakeAnswer> {
  return {
    read: vi.fn(async (query: string, traces: FakeTrace[]) => ({
      outcome: { answer: `answered: ${query}`, citations: traces.map((t) => t.id) },
      strategy: 'single-call' as const,
      readRouterDecision: { intent: 'precise-fact', strategy: 'single-call', costUsd: 0.0150 },
    })),
  };
}

describe('CognitivePipeline: ingest stage', () => {
  it('forwards content to the configured IngestStage', async () => {
    const ingest = makeIngestStage();
    const pipeline = new CognitivePipeline<FakeTrace, FakeAnswer>({ ingest });
    const result = await pipeline.ingest('hello');
    expect(ingest.ingest).toHaveBeenCalledWith('hello', undefined);
    expect(result.writtenTraces).toBe(1);
  });

  it('throws when ingest is called without an IngestStage', async () => {
    const pipeline = new CognitivePipeline<FakeTrace, FakeAnswer>({});
    await expect(pipeline.ingest('hello')).rejects.toThrow(/IngestStage/);
  });
});

describe('CognitivePipeline: recall stage', () => {
  it('forwards query to the configured RecallStage', async () => {
    const recall = makeRecallStage();
    const pipeline = new CognitivePipeline<FakeTrace, FakeAnswer>({ recall });
    const result = await pipeline.recall('what is X?');
    expect(recall.recall).toHaveBeenCalledWith('what is X?', undefined);
    expect(result.traces).toHaveLength(2);
    expect(result.backend).toBe('canonical-hybrid');
  });

  it('throws when recall is called without a RecallStage', async () => {
    const pipeline = new CognitivePipeline<FakeTrace, FakeAnswer>({});
    await expect(pipeline.recall('q')).rejects.toThrow(/RecallStage/);
  });
});

describe('CognitivePipeline: read stage', () => {
  it('forwards query+traces to the configured ReadStage', async () => {
    const read = makeReadStage();
    const pipeline = new CognitivePipeline<FakeTrace, FakeAnswer>({ read });
    const traces: FakeTrace[] = [{ id: 't1', text: 'e' }];
    const result = await pipeline.read('q?', traces);
    expect(read.read).toHaveBeenCalledWith('q?', traces, undefined);
    expect(result.outcome.answer).toBe('answered: q?');
  });

  it('throws when read is called without a ReadStage', async () => {
    const pipeline = new CognitivePipeline<FakeTrace, FakeAnswer>({});
    await expect(
      pipeline.read('q?', []),
    ).rejects.toThrow(/ReadStage/);
  });
});

describe('CognitivePipeline: end-to-end recallAndRead', () => {
  it('chains recall + read in one call and returns full telemetry', async () => {
    const recall = makeRecallStage();
    const read = makeReadStage();
    const pipeline = new CognitivePipeline<FakeTrace, FakeAnswer>({
      recall,
      read,
    });

    const result = await pipeline.recallAndRead('what is X?');

    expect(recall.recall).toHaveBeenCalledTimes(1);
    expect(read.read).toHaveBeenCalledTimes(1);
    // read receives the traces from recall:
    expect((read.read as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toHaveLength(2);
    expect(result.outcome.answer).toBe('answered: what is X?');
    expect(result.recallStage.backend).toBe('canonical-hybrid');
    expect(result.readStage.strategy).toBe('single-call');
  });

  it('throws on recallAndRead when recall stage is missing', async () => {
    const pipeline = new CognitivePipeline<FakeTrace, FakeAnswer>({
      read: makeReadStage(),
    });
    await expect(pipeline.recallAndRead('q')).rejects.toThrow(/RecallStage/);
  });

  it('throws on recallAndRead when read stage is missing', async () => {
    const pipeline = new CognitivePipeline<FakeTrace, FakeAnswer>({
      recall: makeRecallStage(),
    });
    await expect(pipeline.recallAndRead('q')).rejects.toThrow(/ReadStage/);
  });
});

describe('CognitivePipeline: stage availability flags', () => {
  it('hasIngestStage / hasRecallStage / hasReadStage reflect configured stages', () => {
    const empty = new CognitivePipeline<FakeTrace, FakeAnswer>({});
    expect(empty.hasIngestStage).toBe(false);
    expect(empty.hasRecallStage).toBe(false);
    expect(empty.hasReadStage).toBe(false);

    const full = new CognitivePipeline<FakeTrace, FakeAnswer>({
      ingest: makeIngestStage(),
      recall: makeRecallStage(),
      read: makeReadStage(),
    });
    expect(full.hasIngestStage).toBe(true);
    expect(full.hasRecallStage).toBe(true);
    expect(full.hasReadStage).toBe(true);
  });
});
