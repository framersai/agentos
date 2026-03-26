/**
 * @fileoverview Type compilation and shape tests for the Memory facade public API.
 *
 * These tests are intentionally lightweight: their primary job is to verify
 * that the TypeScript compiler accepts the declared interfaces and that the
 * shapes behave as documented (optional fields, index signatures, etc.).
 * No runtime engine is instantiated here.
 *
 * @module memory/facade/__tests__/types.test
 */

import { describe, it, expect } from 'vitest';
import type {
  MemoryConfig,
  EmbeddingConfig,
  ExtendedConsolidationConfig,
  IngestionConfig,
  RememberOptions,
  RecallOptions,
  IngestOptions,
  IngestResult,
  ExportOptions,
  ImportOptions,
  ImportResult,
  ConsolidationResult,
  MemoryHealth,
  LoadOptions,
  LoadedDocument,
  DocumentMetadata,
  DocumentChunk,
  ExtractedImage,
  ExtractedTable,
} from '../types.js';

// ---------------------------------------------------------------------------
// MemoryConfig
// ---------------------------------------------------------------------------

describe('MemoryConfig', () => {
  it('accepts a minimal empty config object', () => {
    // All fields are optional, so an empty object must be assignable.
    const cfg: MemoryConfig = {};
    expect(cfg).toBeDefined();
  });

  it('accepts a fully populated config object', () => {
    const cfg: MemoryConfig = {
      store: 'sqlite',
      path: './data/memory.sqlite',
      embeddings: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 1536,
      },
      graph: true,
      selfImprove: true,
      decay: false,
      consolidation: {
        trigger: 'turns',
        every: 20,
        pruneThreshold: 0.05,
        mergeThreshold: 0.92,
        deriveInsights: true,
        maxDerivedPerCycle: 10,
        intervalMs: 3_600_000,
        maxTracesPerCycle: 500,
        mergeSimilarityThreshold: 0.92,
        minClusterSize: 5,
      },
      ingestion: {
        chunkStrategy: 'semantic',
        chunkSize: 512,
        chunkOverlap: 64,
        extractImages: true,
        ocrEnabled: true,
        doclingEnabled: false,
        visionLlm: 'gpt-4o',
      },
    };
    expect(cfg.store).toBe('sqlite');
    expect(cfg.graph).toBe(true);
    expect(cfg.embeddings?.provider).toBe('openai');
    expect(cfg.consolidation?.trigger).toBe('turns');
    expect(cfg.ingestion?.chunkStrategy).toBe('semantic');
  });

  it('accepts all valid store values', () => {
    const stores: Array<MemoryConfig['store']> = [
      'sqlite', 'memory', 'qdrant', 'neo4j', 'hnsw', undefined,
    ];
    for (const store of stores) {
      const cfg: MemoryConfig = { store };
      expect(cfg).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// EmbeddingConfig
// ---------------------------------------------------------------------------

describe('EmbeddingConfig', () => {
  it('requires provider, treats model and dimensions as optional', () => {
    const minimal: EmbeddingConfig = { provider: 'cohere' };
    expect(minimal.provider).toBe('cohere');
    expect(minimal.model).toBeUndefined();
    expect(minimal.dimensions).toBeUndefined();
  });

  it('accepts all fields', () => {
    const full: EmbeddingConfig = {
      provider: 'openai',
      model: 'text-embedding-ada-002',
      dimensions: 1536,
    };
    expect(full.dimensions).toBe(1536);
  });
});

// ---------------------------------------------------------------------------
// ExtendedConsolidationConfig
// ---------------------------------------------------------------------------

describe('ExtendedConsolidationConfig', () => {
  it('accepts an empty object (all fields optional)', () => {
    const cfg: ExtendedConsolidationConfig = {};
    expect(cfg).toBeDefined();
  });

  it('accepts all trigger variants', () => {
    const triggers: Array<ExtendedConsolidationConfig['trigger']> = [
      'turns', 'interval', 'manual', undefined,
    ];
    for (const trigger of triggers) {
      const cfg: ExtendedConsolidationConfig = { trigger };
      expect(cfg).toBeDefined();
    }
  });

  it('captures both new facade fields and legacy internal fields', () => {
    const cfg: ExtendedConsolidationConfig = {
      trigger: 'interval',
      every: 3_600_000,
      pruneThreshold: 0.05,
      mergeThreshold: 0.90,
      deriveInsights: true,
      maxDerivedPerCycle: 5,
      // legacy fields
      intervalMs: 3_600_000,
      maxTracesPerCycle: 250,
      mergeSimilarityThreshold: 0.88,
      minClusterSize: 3,
    };
    expect(cfg.trigger).toBe('interval');
    expect(cfg.maxTracesPerCycle).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// IngestionConfig
// ---------------------------------------------------------------------------

describe('IngestionConfig', () => {
  it('accepts an empty object', () => {
    const cfg: IngestionConfig = {};
    expect(cfg).toBeDefined();
  });

  it('accepts all chunkStrategy variants', () => {
    const strategies: Array<IngestionConfig['chunkStrategy']> = [
      'fixed', 'semantic', 'hierarchical', 'layout', undefined,
    ];
    for (const chunkStrategy of strategies) {
      const cfg: IngestionConfig = { chunkStrategy };
      expect(cfg).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// RememberOptions
// ---------------------------------------------------------------------------

describe('RememberOptions', () => {
  it('accepts a minimal empty options object', () => {
    const opts: RememberOptions = {};
    expect(opts).toBeDefined();
  });

  it('captures all optional fields', () => {
    const opts: RememberOptions = {
      type: 'episodic',
      scope: 'user',
      scopeId: 'user-42',
      tags: ['important', 'project:alpha'],
      entities: ['Alice', 'Bob'],
      importance: 0.8,
    };
    expect(opts.importance).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// RecallOptions
// ---------------------------------------------------------------------------

describe('RecallOptions', () => {
  it('accepts a minimal empty options object', () => {
    const opts: RecallOptions = {};
    expect(opts).toBeDefined();
  });

  it('captures all optional fields', () => {
    const opts: RecallOptions = {
      limit: 20,
      type: 'semantic',
      scope: 'persona',
      scopeId: 'assistant-1',
      minStrength: 0.2,
    };
    expect(opts.limit).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// IngestOptions
// ---------------------------------------------------------------------------

describe('IngestOptions', () => {
  it('accepts an empty options object', () => {
    const opts: IngestOptions = {};
    expect(opts).toBeDefined();
  });

  it('accepts onProgress callback', () => {
    const calls: Array<{ processed: number; total: number; current: string }> = [];
    const opts: IngestOptions = {
      recursive: true,
      include: ['**/*.md'],
      exclude: ['node_modules/**'],
      format: 'obsidian',
      onProgress: (processed, total, current) => {
        calls.push({ processed, total, current });
      },
    };
    opts.onProgress!(1, 10, 'README.md');
    expect(calls).toHaveLength(1);
    expect(calls[0].processed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// IngestResult — captures partial failures
// ---------------------------------------------------------------------------

describe('IngestResult', () => {
  it('captures a mix of successes and failures', () => {
    const result: IngestResult = {
      succeeded: ['docs/intro.md', 'docs/guide.md'],
      failed: [
        { path: 'docs/corrupted.pdf', error: 'Cannot decrypt PDF' },
      ],
      chunksCreated: 48,
      tracesCreated: 12,
    };
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].path).toBe('docs/corrupted.pdf');
    expect(result.chunksCreated).toBe(48);
  });

  it('accepts an all-success result with no failures', () => {
    const result: IngestResult = {
      succeeded: ['a.md', 'b.md'],
      failed: [],
      chunksCreated: 8,
      tracesCreated: 4,
    };
    expect(result.failed).toHaveLength(0);
  });

  it('accepts an all-failure result with no successes', () => {
    const result: IngestResult = {
      succeeded: [],
      failed: [{ path: 'bad.pdf', error: 'File not found' }],
      chunksCreated: 0,
      tracesCreated: 0,
    };
    expect(result.succeeded).toHaveLength(0);
    expect(result.tracesCreated).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ExportOptions
// ---------------------------------------------------------------------------

describe('ExportOptions', () => {
  it('accepts all format variants', () => {
    const formats: Array<ExportOptions['format']> = [
      'sqlite', 'json', 'markdown', 'obsidian', undefined,
    ];
    for (const format of formats) {
      const opts: ExportOptions = { format };
      expect(opts).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// ImportOptions & ImportResult
// ---------------------------------------------------------------------------

describe('ImportOptions', () => {
  it('accepts all format variants', () => {
    const formats: Array<ImportOptions['format']> = [
      'auto', 'sqlite', 'json', 'markdown', 'obsidian', 'chatgpt', 'csv', undefined,
    ];
    for (const format of formats) {
      const opts: ImportOptions = { format };
      expect(opts).toBeDefined();
    }
  });
});

describe('ImportResult', () => {
  it('captures imported, skipped and errors', () => {
    const result: ImportResult = {
      imported: 150,
      skipped: 10,
      errors: ['Row 42: invalid JSON'],
    };
    expect(result.imported).toBe(150);
    expect(result.errors).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ConsolidationResult
// ---------------------------------------------------------------------------

describe('ConsolidationResult', () => {
  it('captures all counters', () => {
    const result: ConsolidationResult = {
      pruned: 5,
      merged: 3,
      derived: 2,
      compacted: 1,
      durationMs: 412,
    };
    expect(result.durationMs).toBe(412);
  });
});

// ---------------------------------------------------------------------------
// MemoryHealth
// ---------------------------------------------------------------------------

describe('MemoryHealth', () => {
  it('accepts a well-formed health snapshot', () => {
    const health: MemoryHealth = {
      totalTraces: 1000,
      activeTraces: 850,
      avgStrength: 0.65,
      weakestTraceStrength: 0.06,
      graphNodes: 320,
      graphEdges: 540,
      lastConsolidation: '2026-03-25T12:00:00.000Z',
      tracesPerType: { episodic: 500, semantic: 300, procedural: 50 },
      tracesPerScope: { user: 400, thread: 600 },
      documentsIngested: 12,
    };
    expect(health.activeTraces).toBe(850);
    expect(health.lastConsolidation).not.toBeNull();
  });

  it('accepts null lastConsolidation when never run', () => {
    const health: MemoryHealth = {
      totalTraces: 0,
      activeTraces: 0,
      avgStrength: 0,
      weakestTraceStrength: 0,
      graphNodes: 0,
      graphEdges: 0,
      lastConsolidation: null,
      tracesPerType: {},
      tracesPerScope: {},
      documentsIngested: 0,
    };
    expect(health.lastConsolidation).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LoadOptions & LoadedDocument
// ---------------------------------------------------------------------------

describe('LoadOptions', () => {
  it('accepts empty object and a format string', () => {
    const empty: LoadOptions = {};
    const withFormat: LoadOptions = { format: 'pdf' };
    expect(empty).toBeDefined();
    expect(withFormat.format).toBe('pdf');
  });
});

describe('LoadedDocument', () => {
  it('accepts a minimal doc with only required fields', () => {
    const doc: LoadedDocument = {
      content: 'Hello world',
      metadata: {},
      format: 'txt',
    };
    expect(doc.content).toBe('Hello world');
    expect(doc.chunks).toBeUndefined();
  });

  it('accepts a fully populated document', () => {
    const meta: DocumentMetadata = {
      title: 'Test Document',
      author: 'Jane Doe',
      pageCount: 5,
      wordCount: 1200,
      language: 'en',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-03-01T00:00:00.000Z',
      source: '/docs/test.pdf',
      customField: 42,
    };
    const chunk: DocumentChunk = {
      content: 'Introduction paragraph.',
      index: 0,
      pageNumber: 1,
      heading: 'Introduction',
      metadata: { boundingBox: [0, 0, 100, 20] },
    };
    const image: ExtractedImage = {
      data: Buffer.from('fake-image-bytes'),
      mimeType: 'image/png',
      caption: 'Figure 1: Architecture diagram',
      pageNumber: 2,
      embedding: [0.1, 0.2, 0.3],
    };
    const table: ExtractedTable = {
      headers: ['Name', 'Score'],
      rows: [['Alice', '95'], ['Bob', '88']],
      caption: 'Table 1: Scores',
      pageNumber: 3,
    };
    const doc: LoadedDocument = {
      content: 'Full text...',
      metadata: meta,
      chunks: [chunk],
      images: [image],
      tables: [table],
      format: 'pdf',
    };
    expect(doc.metadata.title).toBe('Test Document');
    expect(doc.chunks).toHaveLength(1);
    expect(doc.images).toHaveLength(1);
    expect(doc.tables![0].headers).toContain('Name');
    // Index signature allows arbitrary metadata fields
    expect(meta.customField).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// DocumentChunk standalone
// ---------------------------------------------------------------------------

describe('DocumentChunk', () => {
  it('requires only content and index', () => {
    const chunk: DocumentChunk = { content: 'Some text', index: 0 };
    expect(chunk.pageNumber).toBeUndefined();
    expect(chunk.heading).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ExtractedImage standalone
// ---------------------------------------------------------------------------

describe('ExtractedImage', () => {
  it('requires data and mimeType; embedding is optional', () => {
    const img: ExtractedImage = {
      data: Buffer.alloc(0),
      mimeType: 'image/jpeg',
    };
    expect(img.embedding).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ExtractedTable standalone
// ---------------------------------------------------------------------------

describe('ExtractedTable', () => {
  it('requires headers and rows', () => {
    const tbl: ExtractedTable = {
      headers: ['Col A'],
      rows: [['value']],
    };
    expect(tbl.caption).toBeUndefined();
  });
});
