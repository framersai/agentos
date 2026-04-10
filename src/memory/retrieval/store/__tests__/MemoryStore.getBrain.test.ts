import { describe, it, expect } from 'vitest';
import { SqliteBrain } from '../SqliteBrain.js';
import { MemoryStore } from '../MemoryStore.js';
import { InMemoryVectorStore } from '../../../../rag/vector_stores/InMemoryVectorStore.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

describe('MemoryStore.getBrain', () => {
  it('returns null when no brain is attached', () => {
    const vectorStore = new InMemoryVectorStore();
    const store = new MemoryStore({
      vectorStore,
      embeddingManager: { generateEmbeddings: async () => ({ embeddings: [[0.1]] }) } as any,
    });
    expect(store.getBrain()).toBeNull();
  });

  it('returns the brain after setBrain()', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memstore-test-'));
    const dbPath = path.join(tmpDir, 'test.sqlite');
    const brain = await SqliteBrain.open(dbPath);

    const vectorStore = new InMemoryVectorStore();
    const store = new MemoryStore({
      vectorStore,
      embeddingManager: { generateEmbeddings: async () => ({ embeddings: [[0.1]] }) } as any,
    });

    store.setBrain(brain);
    expect(store.getBrain()).toBe(brain);

    await brain.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
