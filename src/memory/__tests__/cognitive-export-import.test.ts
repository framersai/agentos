import { describe, it, expect, afterEach } from 'vitest';
import { CognitiveMemoryManager } from '../CognitiveMemoryManager.js';
import { Brain } from '../retrieval/store/Brain.js';
import { InMemoryVectorStore } from '../../rag/vector_stores/InMemoryVectorStore.js';
import { InMemoryWorkingMemory } from '../../cognitive_substrate/memory/InMemoryWorkingMemory.js';
import { KnowledgeGraph } from '../retrieval/graph/knowledge/KnowledgeGraph.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const p of cleanupPaths) {
    fs.rmSync(p, { recursive: true, force: true });
  }
  cleanupPaths.length = 0;
});

async function createTestManager(): Promise<{ manager: CognitiveMemoryManager; brain: Brain }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogmem-export-'));
  cleanupPaths.push(tmpDir);
  const dbPath = path.join(tmpDir, 'brain.sqlite');
  const brain = await Brain.openSqlite(dbPath);

  const vectorStore = new InMemoryVectorStore();
  await vectorStore.initialize({ id: 'test-export', type: 'in_memory' });

  const manager = new CognitiveMemoryManager();
  await (manager as any).initialize({
    agentId: 'test-agent',
    traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honesty: 0.5 },
    moodProvider: () => ({ valence: 0, arousal: 0, dominance: 0 }),
    featureDetectionStrategy: 'keyword',
    workingMemory: new InMemoryWorkingMemory(),
    knowledgeGraph: new KnowledgeGraph(),
    vectorStore,
    embeddingManager: {
      generateEmbeddings: async ({ texts }: { texts: string | string[] }) => {
        const input = Array.isArray(texts) ? texts : [texts];
        return { embeddings: input.map(() => Array.from({ length: 8 }, () => Math.random())) };
      },
    },
    encoding: { baseStrength: 0.5, flashbulbThreshold: 0.8, flashbulbStrengthMultiplier: 2.0, flashbulbStabilityMultiplier: 5.0, baseStabilityMs: 3_600_000 },
    brain,
  });

  return { manager, brain };
}

describe('CognitiveMemoryManager export/import', () => {
  it('exports brain state as JSON string', async () => {
    const { manager, brain } = await createTestManager();

    // Insert a trace directly into the brain
    await brain.run(
      `INSERT INTO memory_traces (brain_id, id, type, scope, content, strength, created_at, tags, emotions, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [brain.brainId, 'mt_export_1', 'episodic', 'user', 'The player likes hiking', 1.0, Date.now(), '[]', '{}', '{}'],
    );

    const json = await manager.exportToString();
    const parsed = JSON.parse(json);

    expect(parsed.traces).toBeDefined();
    expect(parsed.traces.length).toBeGreaterThanOrEqual(1);
    expect(parsed.traces.some((t: any) => t.content === 'The player likes hiking')).toBe(true);

    await brain.close();
  });

  it('imports JSON string into brain with dedup', async () => {
    const { manager: sourceManager, brain: sourceBrain } = await createTestManager();
    const { manager: targetManager, brain: targetBrain } = await createTestManager();

    await sourceBrain.run(
      `INSERT INTO memory_traces (brain_id, id, type, scope, content, strength, created_at, tags, emotions, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sourceBrain.brainId, 'mt_src_1', 'semantic', 'user', 'Paris is the capital of France', 1.0, Date.now(), '[]', '{}', '{}'],
    );

    const json = await sourceManager.exportToString();
    const result = await targetManager.importFromString(json);

    expect(result.imported).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);

    // Import again — should dedup
    const result2 = await targetManager.importFromString(json);
    expect(result2.skipped).toBeGreaterThanOrEqual(1);

    await sourceBrain.close();
    await targetBrain.close();
  });

  it('throws when no brain is attached', async () => {
    const vectorStore = new InMemoryVectorStore();
    await vectorStore.initialize({ id: 'no-brain', type: 'in_memory' });

    const manager = new CognitiveMemoryManager();
    await (manager as any).initialize({
      agentId: 'no-brain-agent',
      traits: {},
      moodProvider: () => ({ valence: 0, arousal: 0, dominance: 0 }),
      featureDetectionStrategy: 'keyword',
      workingMemory: new InMemoryWorkingMemory(),
      knowledgeGraph: new KnowledgeGraph(),
      vectorStore,
      embeddingManager: {
        generateEmbeddings: async () => ({ embeddings: [[0.1]] }),
      },
      // No brain passed
    });

    await expect(manager.exportToString()).rejects.toThrow('Cannot export');
    await expect(manager.importFromString('{}')).rejects.toThrow('Cannot import');
  });
});
