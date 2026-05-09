import { describe, it, expect } from 'vitest';
import { CognitiveMemoryManager, type FlushReflectionResult } from '../CognitiveMemoryManager.js';
import type { MemoryReflector } from '../pipeline/observation/MemoryReflector.js';

describe('CognitiveMemoryManager.flushReflection API surface', () => {
  it('getReflector() and flushReflection() are callable on an uninitialized manager', async () => {
    const manager = new CognitiveMemoryManager();

    // getReflector returns null before initialize() wires a reflector.
    expect(manager.getReflector()).toBeNull();

    // flushReflection returns empty result when reflector is null.
    const result: FlushReflectionResult = await manager.flushReflection();
    expect(result.encodedTraceIds).toEqual([]);
    expect(result.supersededTraceIds).toEqual([]);
    expect(typeof result.compressionRatio).toBe('number');
  });

  it('flushReflection delegates to reflector.reflect when a reflector is attached', async () => {
    const manager = new CognitiveMemoryManager();

    // Inject a minimal reflector stub directly into the private field.
    // This bypasses the full initialize() path but exercises the
    // flushReflection code path that matters: does it call reflect()
    // and return an empty-on-empty result correctly?
    const stubReflector = {
      reflect: async () => ({
        traces: [],
        supersededTraceIds: [],
        consumedNoteIds: [],
        compressionRatio: 1,
      }),
    } as unknown as MemoryReflector;
    (manager as unknown as { reflector: MemoryReflector | null }).reflector = stubReflector;

    expect(manager.getReflector()).toBe(stubReflector);

    const result = await manager.flushReflection();
    expect(result.encodedTraceIds).toEqual([]);
    expect(result.supersededTraceIds).toEqual([]);
    expect(result.compressionRatio).toBe(1);
  });
});
