/**
 * @fileoverview Tests for the observation compression, reflection, and temporal
 * reasoning subsystems.
 *
 * Covers:
 * 1. ObservationCompressor — mock LLM, verify compression output structure
 * 2. ObservationReflector — mock LLM, verify reflection output structure
 * 3. relativeTimeLabel — utility producing human-friendly time descriptions
 * 4. Temporal filtering in Memory.recall() (after/before options)
 * 5. MemoryObserver compression/reflection wiring (compressIfNeeded, reflectIfNeeded)
 *
 * @module agentos/memory/observation/__tests__/observation.test
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ObservationCompressor } from '../ObservationCompressor.js';
import { ObservationReflector } from '../ObservationReflector.js';
import { relativeTimeLabel } from '../temporal.js';
import { MemoryObserver } from '../MemoryObserver.js';
import type { ObservationNote } from '../MemoryObserver.js';
import type { CompressedObservation } from '../ObservationCompressor.js';
import { Memory } from '../../../io/facade/Memory.js';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

const cleanupPaths: string[] = [];
const openMemories: Memory[] = [];

function tempDb(): string {
  const p = path.join(
    os.tmpdir(),
    `agentos-obs-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
  cleanupPaths.push(p);
  return p;
}

async function createMemory(overrides?: Record<string, unknown>): Promise<Memory> {
  const dbPath = tempDb();
  const mem = await Memory.create({
    store: 'sqlite',
    path: dbPath,
    graph: true,
    selfImprove: true,
    decay: true,
    ...overrides,
  });
  openMemories.push(mem);
  return mem;
}

afterEach(async () => {
  for (const mem of openMemories) {
    try { await mem.close(); } catch { /* */ }
  }
  openMemories.length = 0;
  for (const p of cleanupPaths) {
    try {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
      } else {
        fs.unlinkSync(p);
      }
    } catch { /* */ }
  }
  cleanupPaths.length = 0;
});

// ---------------------------------------------------------------------------
// Mock observation notes
// ---------------------------------------------------------------------------

function makeMockNotes(count: number, baseTimestamp?: number): ObservationNote[] {
  const base = baseTimestamp ?? Date.now();
  return Array.from({ length: count }, (_, i) => ({
    id: `obs_mock_${i}`,
    type: 'factual' as const,
    content: `Observation ${i}: The user discussed topic ${i}`,
    importance: 0.5 + (i % 5) * 0.1,
    entities: [`entity_${i}`, 'shared_entity'],
    timestamp: base + i * 1000,
  }));
}

function makeMockCompressed(count: number): CompressedObservation[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    id: `cobs_mock_${i}`,
    summary: `Compressed summary ${i}: Multiple observations about topic ${i} were merged.`,
    priority: 'important' as const,
    temporal: {
      observedAt: now,
      referencedAt: now - i * 3600_000,
      relativeLabel: `${i} hours ago`,
    },
    sourceIds: [`obs_mock_${i * 2}`, `obs_mock_${i * 2 + 1}`],
    entities: [`entity_${i}`],
    importance: 0.7,
  }));
}

// ---------------------------------------------------------------------------
// 1. ObservationCompressor tests
// ---------------------------------------------------------------------------

describe('ObservationCompressor', () => {
  it('compresses notes into CompressedObservation objects via LLM', async () => {
    const mockLlm = async (_system: string, _user: string): Promise<string> => {
      return JSON.stringify([
        {
          summary: 'User discussed topics 0 and 1 related to shared entity.',
          priority: 'important',
          sourceIds: ['obs_mock_0', 'obs_mock_1'],
          entities: ['entity_0', 'entity_1', 'shared_entity'],
        },
        {
          summary: 'User mentioned topic 2 with high importance.',
          priority: 'critical',
          sourceIds: ['obs_mock_2'],
          entities: ['entity_2'],
        },
      ]);
    };

    const compressor = new ObservationCompressor(mockLlm);
    const notes = makeMockNotes(3);
    const result = await compressor.compress(notes);

    expect(result).toHaveLength(2);

    // First compressed observation
    expect(result[0].summary).toContain('topics 0 and 1');
    expect(result[0].priority).toBe('important');
    expect(result[0].sourceIds).toEqual(['obs_mock_0', 'obs_mock_1']);
    expect(result[0].entities).toContain('shared_entity');
    expect(result[0].id).toMatch(/^cobs_/);
    expect(result[0].temporal).toBeDefined();
    expect(result[0].temporal.observedAt).toBeGreaterThan(0);
    expect(result[0].temporal.referencedAt).toBeGreaterThan(0);
    expect(typeof result[0].temporal.relativeLabel).toBe('string');

    // Second compressed observation
    expect(result[1].priority).toBe('critical');
    expect(result[1].sourceIds).toEqual(['obs_mock_2']);
  });

  it('returns empty array on LLM failure', async () => {
    const failingLlm = async (): Promise<string> => {
      throw new Error('LLM unavailable');
    };

    const compressor = new ObservationCompressor(failingLlm);
    const result = await compressor.compress(makeMockNotes(5));

    expect(result).toEqual([]);
  });

  it('returns empty array for empty input', async () => {
    const mockLlm = async (): Promise<string> => '[]';
    const compressor = new ObservationCompressor(mockLlm);
    const result = await compressor.compress([]);

    expect(result).toEqual([]);
  });

  it('handles malformed LLM JSON gracefully', async () => {
    const mockLlm = async (): Promise<string> => 'not valid json at all {}';
    const compressor = new ObservationCompressor(mockLlm);
    const notes = makeMockNotes(3);
    const result = await compressor.compress(notes);

    // Should return empty or partial — not throw
    expect(Array.isArray(result)).toBe(true);
  });

  it('applies HEXACO personality traits to compression prompt', async () => {
    let capturedSystem = '';
    const mockLlm = async (system: string): Promise<string> => {
      capturedSystem = system;
      return '[]';
    };

    const compressor = new ObservationCompressor(mockLlm, {
      conscientiousness: 0.9,
      openness: 0.3,
    });
    await compressor.compress(makeMockNotes(2));

    expect(capturedSystem).toContain('commitments');
    expect(capturedSystem).not.toContain('creative');
  });

  it('computes average importance from source notes', async () => {
    const mockLlm = async (): Promise<string> => {
      return JSON.stringify([
        {
          summary: 'Combined observation.',
          priority: 'informational',
          sourceIds: ['obs_mock_0', 'obs_mock_1'],
          entities: [],
        },
      ]);
    };

    const notes: ObservationNote[] = [
      { ...makeMockNotes(1)[0], id: 'obs_mock_0', importance: 0.3 },
      { ...makeMockNotes(1)[0], id: 'obs_mock_1', importance: 0.7 },
    ];

    const compressor = new ObservationCompressor(mockLlm);
    const result = await compressor.compress(notes);

    expect(result).toHaveLength(1);
    expect(result[0].importance).toBeCloseTo(0.5, 1);
  });
});

// ---------------------------------------------------------------------------
// 2. ObservationReflector tests
// ---------------------------------------------------------------------------

describe('ObservationReflector', () => {
  it('produces Reflection objects from compressed observations', async () => {
    const mockLlm = async (_system: string, _user: string): Promise<string> => {
      return JSON.stringify([
        {
          insight: 'The user consistently prefers dark mode across all applications.',
          patternType: 'preference',
          confidence: 0.85,
          sourceIds: ['cobs_mock_0', 'cobs_mock_1'],
        },
        {
          insight: 'The user is working towards a Q3 launch deadline.',
          patternType: 'goal',
          confidence: 0.7,
          sourceIds: ['cobs_mock_2'],
        },
      ]);
    };

    const reflector = new ObservationReflector(mockLlm);
    const compressed = makeMockCompressed(3);
    const result = await reflector.reflect(compressed);

    expect(result).toHaveLength(2);

    // First reflection
    expect(result[0].insight).toContain('dark mode');
    expect(result[0].patternType).toBe('preference');
    expect(result[0].confidence).toBe(0.85);
    expect(result[0].sourceIds).toEqual(['cobs_mock_0', 'cobs_mock_1']);
    expect(result[0].id).toMatch(/^refl_/);
    expect(result[0].temporal).toBeDefined();
    expect(result[0].temporal.reflectedAt).toBeGreaterThan(0);
    expect(result[0].temporal.spanStart).toBeGreaterThan(0);
    expect(result[0].temporal.spanEnd).toBeGreaterThanOrEqual(result[0].temporal.spanStart);
    expect(typeof result[0].temporal.relativeLabel).toBe('string');

    // Second reflection
    expect(result[1].patternType).toBe('goal');
  });

  it('returns empty array on LLM failure', async () => {
    const failingLlm = async (): Promise<string> => {
      throw new Error('LLM unavailable');
    };

    const reflector = new ObservationReflector(failingLlm);
    const result = await reflector.reflect(makeMockCompressed(3));

    expect(result).toEqual([]);
  });

  it('returns empty array for empty input', async () => {
    const mockLlm = async (): Promise<string> => '[]';
    const reflector = new ObservationReflector(mockLlm);
    const result = await reflector.reflect([]);

    expect(result).toEqual([]);
  });

  it('clamps confidence to 0-1 range', async () => {
    const mockLlm = async (): Promise<string> => {
      return JSON.stringify([
        {
          insight: 'Test insight with out-of-range confidence.',
          patternType: 'behavior',
          confidence: 1.5,
          sourceIds: [],
        },
      ]);
    };

    const reflector = new ObservationReflector(mockLlm);
    const result = await reflector.reflect(makeMockCompressed(1));

    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(1.0);
  });

  it('defaults unknown pattern types to behavior', async () => {
    const mockLlm = async (): Promise<string> => {
      return JSON.stringify([
        {
          insight: 'Test insight with unknown pattern.',
          patternType: 'unknown_type',
          confidence: 0.5,
          sourceIds: [],
        },
      ]);
    };

    const reflector = new ObservationReflector(mockLlm);
    const result = await reflector.reflect(makeMockCompressed(1));

    expect(result).toHaveLength(1);
    expect(result[0].patternType).toBe('behavior');
  });
});

// ---------------------------------------------------------------------------
// 3. relativeTimeLabel tests
// ---------------------------------------------------------------------------

describe('relativeTimeLabel', () => {
  const SECOND = 1_000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  // Use a fixed reference time for deterministic tests.
  // Wednesday, 2026-03-25 12:00:00 UTC
  const now = new Date('2026-03-25T12:00:00Z').getTime();

  it('returns "just now" for < 60 seconds ago', () => {
    expect(relativeTimeLabel(now - 30 * SECOND, now)).toBe('just now');
    expect(relativeTimeLabel(now - 1 * SECOND, now)).toBe('just now');
    expect(relativeTimeLabel(now, now)).toBe('just now');
  });

  it('returns "N minutes ago" for < 1 hour', () => {
    expect(relativeTimeLabel(now - 1 * MINUTE, now)).toBe('1 minute ago');
    expect(relativeTimeLabel(now - 5 * MINUTE, now)).toBe('5 minutes ago');
    expect(relativeTimeLabel(now - 30 * MINUTE, now)).toBe('30 minutes ago');
    expect(relativeTimeLabel(now - 59 * MINUTE, now)).toBe('59 minutes ago');
  });

  it('returns hour-based label or "earlier today" for same day', () => {
    // 1 hour ago same day
    const result1h = relativeTimeLabel(now - 1 * HOUR, now);
    expect(result1h).toBe('1 hour ago');

    // 3 hours ago same day (still today since now is 12:00)
    const result3h = relativeTimeLabel(now - 3 * HOUR, now);
    expect(result3h).toBe('earlier today');
  });

  it('returns "yesterday" for previous calendar day', () => {
    expect(relativeTimeLabel(now - 1 * DAY, now)).toBe('yesterday');
  });

  it('returns "last <DayName>" for 2-6 days ago', () => {
    // 3 days ago from Wednesday = Sunday
    const result = relativeTimeLabel(now - 3 * DAY, now);
    expect(result).toBe('last Sunday');

    // 5 days ago from Wednesday = Friday
    const result2 = relativeTimeLabel(now - 5 * DAY, now);
    expect(result2).toBe('last Friday');
  });

  it('returns "last week" for 7-13 days ago', () => {
    expect(relativeTimeLabel(now - 7 * DAY, now)).toBe('last week');
    expect(relativeTimeLabel(now - 10 * DAY, now)).toBe('last week');
    expect(relativeTimeLabel(now - 13 * DAY, now)).toBe('last week');
  });

  it('returns "N weeks ago" for 14-27 days ago', () => {
    expect(relativeTimeLabel(now - 14 * DAY, now)).toBe('2 weeks ago');
    expect(relativeTimeLabel(now - 21 * DAY, now)).toBe('3 weeks ago');
  });

  it('returns "last month" for 28-59 days ago', () => {
    expect(relativeTimeLabel(now - 30 * DAY, now)).toBe('last month');
    expect(relativeTimeLabel(now - 45 * DAY, now)).toBe('last month');
  });

  it('returns "N months ago" for 60-364 days ago', () => {
    expect(relativeTimeLabel(now - 60 * DAY, now)).toBe('2 months ago');
    expect(relativeTimeLabel(now - 180 * DAY, now)).toBe('6 months ago');
  });

  it('returns "last year" for 365-729 days ago', () => {
    expect(relativeTimeLabel(now - 365 * DAY, now)).toBe('last year');
    expect(relativeTimeLabel(now - 500 * DAY, now)).toBe('last year');
  });

  it('returns "N years ago" for 730+ days ago', () => {
    expect(relativeTimeLabel(now - 730 * DAY, now)).toBe('2 years ago');
    expect(relativeTimeLabel(now - 1095 * DAY, now)).toBe('3 years ago');
  });

  it('returns "in the future" for future timestamps', () => {
    expect(relativeTimeLabel(now + 60 * SECOND, now)).toBe('in the future');
  });
});

// ---------------------------------------------------------------------------
// 4. Temporal filtering in Memory.recall()
// ---------------------------------------------------------------------------

describe('Memory.recall() temporal filtering', () => {
  it('filters traces by after timestamp', async () => {
    const mem = await createMemory();
    const t1 = Date.now() - 5000;

    await mem.remember('old memory about cats', { tags: ['cats'] });

    // Small delay so the second memory has a later created_at
    await new Promise((r) => setTimeout(r, 50));
    const afterTs = Date.now();
    await new Promise((r) => setTimeout(r, 50));

    await mem.remember('new memory about dogs', { tags: ['dogs'] });

    // Recall with after filter — should only return the newer memory.
    const results = await mem.recall('memory', { after: afterTs });

    expect(results.length).toBe(1);
    expect(results[0].trace.content).toContain('dogs');
  });

  it('filters traces by before timestamp', async () => {
    const mem = await createMemory();

    await mem.remember('early memory about trees', { tags: ['trees'] });
    await new Promise((r) => setTimeout(r, 50));
    const beforeTs = Date.now();
    await new Promise((r) => setTimeout(r, 50));
    await mem.remember('late memory about flowers', { tags: ['flowers'] });

    // Recall with before filter — should only return the earlier memory.
    const results = await mem.recall('memory', { before: beforeTs });

    expect(results.length).toBe(1);
    expect(results[0].trace.content).toContain('trees');
  });

  it('filters traces by both after and before timestamps', async () => {
    const mem = await createMemory();

    await mem.remember('first memory alpha');
    await new Promise((r) => setTimeout(r, 50));
    const afterTs = Date.now();
    await new Promise((r) => setTimeout(r, 50));
    await mem.remember('second memory beta');
    await new Promise((r) => setTimeout(r, 50));
    const beforeTs = Date.now();
    await new Promise((r) => setTimeout(r, 50));
    await mem.remember('third memory gamma');

    // Only the middle memory should be returned.
    const results = await mem.recall('memory', { after: afterTs, before: beforeTs });

    expect(results.length).toBe(1);
    expect(results[0].trace.content).toContain('beta');
  });

  it('returns empty when no traces match time range', async () => {
    const mem = await createMemory();

    await mem.remember('some memory content');

    const futureTs = Date.now() + 60_000;
    const results = await mem.recall('memory', { after: futureTs });

    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. MemoryObserver compression/reflection wiring
// ---------------------------------------------------------------------------

describe('MemoryObserver compression/reflection wiring', () => {
  it('accumulates notes and triggers compression when threshold is met', async () => {
    let callCount = 0;
    const mockLlm = async (_system: string, _user: string): Promise<string> => {
      callCount++;
      // First calls: observation extraction
      if (callCount <= 2) {
        return Array.from({ length: 30 }, (_, i) =>
          JSON.stringify({ type: 'factual', content: `Note ${i}`, importance: 0.5, entities: [] }),
        ).join('\n');
      }
      // Compression call
      return JSON.stringify([
        {
          summary: 'Combined summary of all notes.',
          priority: 'important',
          sourceIds: [],
          entities: [],
        },
      ]);
    };

    const observer = new MemoryObserver(
      { conscientiousness: 0.5 },
      { activationThresholdTokens: 100, llmInvoker: mockLlm },
    );
    observer.setCompressionThreshold(50);

    // Push enough content to trigger observation extraction twice.
    // Each extraction produces 30 notes, so after 2 extractions we have 60 notes.
    await observer.observe('user', 'A'.repeat(500));
    await observer.observe('user', 'B'.repeat(500));

    expect(observer.getAccumulatedNoteCount()).toBe(60);

    // Compression should trigger (60 >= 50)
    const compressed = await observer.compressIfNeeded();
    expect(compressed).not.toBeNull();
    expect(compressed!.length).toBeGreaterThan(0);
    expect(observer.getAccumulatedNoteCount()).toBe(0);
    expect(observer.getAccumulatedCompressedCount()).toBeGreaterThan(0);
  });

  it('does not trigger compression below threshold', async () => {
    const mockLlm = async (): Promise<string> => {
      return JSON.stringify({ type: 'factual', content: 'Single note', importance: 0.5, entities: [] });
    };

    const observer = new MemoryObserver(
      { conscientiousness: 0.5 },
      { activationThresholdTokens: 100, llmInvoker: mockLlm },
    );
    observer.setCompressionThreshold(50);

    await observer.observe('user', 'A'.repeat(500));
    expect(observer.getAccumulatedNoteCount()).toBe(1);

    const result = await observer.compressIfNeeded();
    expect(result).toBeNull();
  });

  it('clear() resets all accumulated state', async () => {
    const mockLlm = async (): Promise<string> => {
      return JSON.stringify({ type: 'factual', content: 'Test', importance: 0.5, entities: [] });
    };

    const observer = new MemoryObserver(
      { conscientiousness: 0.5 },
      { activationThresholdTokens: 100, llmInvoker: mockLlm },
    );

    await observer.observe('user', 'A'.repeat(500));
    expect(observer.getAccumulatedNoteCount()).toBeGreaterThan(0);

    observer.clear();
    expect(observer.getAccumulatedNoteCount()).toBe(0);
    expect(observer.getAccumulatedCompressedCount()).toBe(0);
  });

  it('parseNotes includes temporal metadata', async () => {
    const mockLlm = async (): Promise<string> => {
      return JSON.stringify({ type: 'factual', content: 'User prefers dark mode.', importance: 0.8, entities: ['dark mode'] });
    };

    const observer = new MemoryObserver(
      { conscientiousness: 0.5 },
      { activationThresholdTokens: 100, llmInvoker: mockLlm },
    );

    const notes = await observer.observe('user', 'A'.repeat(500));
    expect(notes).not.toBeNull();
    expect(notes!.length).toBeGreaterThan(0);

    const note = notes![0];
    expect(note.temporal).toBeDefined();
    expect(note.temporal!.observedAt).toBeGreaterThan(0);
    expect(note.temporal!.referencedAt).toBeGreaterThan(0);
    expect(typeof note.temporal!.relativeLabel).toBe('string');
  });
});
