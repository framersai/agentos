/**
 * @fileoverview Capability Index — vector index over all capabilities.
 * @module @framers/agentos/discovery/CapabilityIndex
 *
 * Normalizes tools, skills, extensions, and channels into unified
 * CapabilityDescriptor objects, embeds them, and stores them in a
 * vector index for semantic search.
 *
 * Reuses existing infrastructure:
 * - IEmbeddingManager for embedding generation (with LRU cache)
 * - IVectorStore for vector storage (InMemory, HNSW, Qdrant, SQL)
 *
 * Performance targets:
 * - Index build: ~3s for ~100 capabilities (one-time, embedding API calls)
 * - Search: <1ms HNSW lookup + ~50ms embedding cold / <5ms warm
 */

import type { IEmbeddingManager } from '../rag/IEmbeddingManager.js';
import type { IVectorStore, VectorDocument, MetadataFilter } from '../rag/IVectorStore.js';
import type {
  CapabilityDescriptor,
  CapabilityKind,
  CapabilitySearchResult,
  CapabilityIndexSources,
  CapabilityDiscoveryConfig,
} from './types.js';
import { CapabilityEmbeddingStrategy } from './CapabilityEmbeddingStrategy.js';

// ============================================================================
// CAPABILITY INDEX
// ============================================================================

export class CapabilityIndex {
  private readonly descriptors: Map<string, CapabilityDescriptor> = new Map();
  private readonly embeddingStrategy: CapabilityEmbeddingStrategy;
  private built = false;

  constructor(
    private readonly embeddingManager: IEmbeddingManager,
    private readonly vectorStore: IVectorStore,
    private readonly collectionName: string,
    private readonly embeddingModelId?: string,
  ) {
    this.embeddingStrategy = new CapabilityEmbeddingStrategy();
  }

  // ============================================================================
  // INDEX LIFECYCLE
  // ============================================================================

  /**
   * Build the index from all capability sources.
   * Normalizes sources into CapabilityDescriptors, embeds them, and stores
   * in the vector store.
   */
  async buildIndex(sources: CapabilityIndexSources): Promise<void> {
    // 1. Normalize all sources into CapabilityDescriptors
    const descriptors = this.normalizeSources(sources);

    // 2. Store descriptors in memory
    for (const desc of descriptors) {
      this.descriptors.set(desc.id, desc);
    }

    if (descriptors.length === 0) {
      this.built = true;
      return;
    }

    // 3. Generate embedding texts
    const embeddingTexts = descriptors.map((d) =>
      this.embeddingStrategy.buildEmbeddingText(d),
    );

    // 4. Batch embed all capabilities
    const embeddingResponse = await this.embeddingManager.generateEmbeddings({
      texts: embeddingTexts,
      modelId: this.embeddingModelId,
    });

    // 5. Create collection if the store supports it
    if (this.vectorStore.createCollection) {
      const dimension = embeddingResponse.embeddings[0]?.length;
      if (dimension) {
        const exists = this.vectorStore.collectionExists
          ? await this.vectorStore.collectionExists(this.collectionName)
          : false;
        if (!exists) {
          await this.vectorStore.createCollection(this.collectionName, dimension, {
            similarityMetric: 'cosine',
          });
        }
      }
    }

    // 6. Upsert into vector store
    const documents: VectorDocument[] = descriptors.map((desc, i) => ({
      id: desc.id,
      embedding: embeddingResponse.embeddings[i],
      metadata: {
        kind: desc.kind,
        name: desc.name,
        category: desc.category,
        available: desc.available,
      },
      textContent: embeddingTexts[i],
    }));

    await this.vectorStore.upsert(this.collectionName, documents);

    this.built = true;
  }

  /**
   * Incrementally add or update a single capability.
   */
  async upsertCapability(cap: CapabilityDescriptor): Promise<void> {
    this.descriptors.set(cap.id, cap);

    const text = this.embeddingStrategy.buildEmbeddingText(cap);
    const response = await this.embeddingManager.generateEmbeddings({
      texts: text,
      modelId: this.embeddingModelId,
    });

    const doc: VectorDocument = {
      id: cap.id,
      embedding: response.embeddings[0],
      metadata: {
        kind: cap.kind,
        name: cap.name,
        category: cap.category,
        available: cap.available,
      },
      textContent: text,
    };

    await this.vectorStore.upsert(this.collectionName, [doc]);
  }

  /**
   * Remove a capability from the index.
   */
  async removeCapability(id: string): Promise<void> {
    this.descriptors.delete(id);
    await this.vectorStore.delete(this.collectionName, [id]);
  }

  // ============================================================================
  // SEARCH
  // ============================================================================

  /**
   * Semantic search for capabilities matching a query.
   *
   * @param query - Natural language query (e.g., "search the web for news")
   * @param topK - Number of results to return
   * @param filters - Optional filters by kind, category, availability
   */
  async search(
    query: string,
    topK: number,
    filters?: {
      kind?: CapabilityKind | 'any';
      category?: string;
      onlyAvailable?: boolean;
    },
  ): Promise<CapabilitySearchResult[]> {
    if (!this.built || this.descriptors.size === 0) {
      return [];
    }

    // Embed the query
    const queryResponse = await this.embeddingManager.generateEmbeddings({
      texts: query,
      modelId: this.embeddingModelId,
    });
    const queryEmbedding = queryResponse.embeddings[0];

    // Build metadata filter
    const metadataFilter: MetadataFilter = {};
    if (filters?.kind && filters.kind !== 'any') {
      metadataFilter.kind = filters.kind;
    }
    if (filters?.category) {
      metadataFilter.category = filters.category;
    }
    if (filters?.onlyAvailable) {
      metadataFilter.available = true;
    }

    // Query vector store
    const result = await this.vectorStore.query(this.collectionName, queryEmbedding, {
      topK,
      filter: Object.keys(metadataFilter).length > 0 ? metadataFilter : undefined,
      includeMetadata: true,
    });

    // Map results back to CapabilityDescriptors
    return result.documents
      .map((doc) => {
        const descriptor = this.descriptors.get(doc.id);
        if (!descriptor) return null;
        return {
          descriptor,
          score: doc.similarityScore,
        };
      })
      .filter((r): r is CapabilitySearchResult => r !== null);
  }

  // ============================================================================
  // ACCESSORS
  // ============================================================================

  /**
   * Get a capability by ID.
   */
  getCapability(id: string): CapabilityDescriptor | undefined {
    return this.descriptors.get(id);
  }

  /**
   * Get all registered capabilities.
   */
  getAllCapabilities(): CapabilityDescriptor[] {
    return Array.from(this.descriptors.values());
  }

  /**
   * Get all capability IDs.
   */
  listIds(): string[] {
    return Array.from(this.descriptors.keys());
  }

  /**
   * Get capabilities grouped by category.
   */
  getByCategory(): Map<string, CapabilityDescriptor[]> {
    const grouped = new Map<string, CapabilityDescriptor[]>();
    for (const desc of this.descriptors.values()) {
      const list = grouped.get(desc.category) ?? [];
      list.push(desc);
      grouped.set(desc.category, list);
    }
    return grouped;
  }

  /**
   * Whether the index has been built.
   */
  isBuilt(): boolean {
    return this.built;
  }

  /**
   * Number of indexed capabilities.
   */
  size(): number {
    return this.descriptors.size;
  }

  /**
   * Get the embedding strategy (for external use by assembler).
   */
  getEmbeddingStrategy(): CapabilityEmbeddingStrategy {
    return this.embeddingStrategy;
  }

  // ============================================================================
  // SOURCE NORMALIZATION
  // ============================================================================

  /**
   * Normalize all sources into CapabilityDescriptor objects.
   */
  normalizeSources(sources: CapabilityIndexSources): CapabilityDescriptor[] {
    const descriptors: CapabilityDescriptor[] = [];

    if (sources.tools) {
      for (const tool of sources.tools) {
        descriptors.push(this.normalizeToolSource(tool));
      }
    }

    if (sources.skills) {
      for (const skill of sources.skills) {
        descriptors.push(this.normalizeSkillSource(skill));
      }
    }

    if (sources.extensions) {
      for (const ext of sources.extensions) {
        descriptors.push(this.normalizeExtensionSource(ext));
      }
    }

    if (sources.channels) {
      for (const ch of sources.channels) {
        descriptors.push(this.normalizeChannelSource(ch));
      }
    }

    if (sources.manifests) {
      for (const manifest of sources.manifests) {
        descriptors.push(manifest);
      }
    }

    return descriptors;
  }

  private normalizeToolSource(tool: NonNullable<CapabilityIndexSources['tools']>[0]): CapabilityDescriptor {
    return {
      id: `tool:${tool.name}`,
      kind: 'tool',
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      category: tool.category ?? 'general',
      tags: [],
      requiredSecrets: [],
      requiredTools: [],
      available: true,
      hasSideEffects: tool.hasSideEffects,
      fullSchema: tool.inputSchema,
      sourceRef: { type: 'tool', toolName: tool.name },
    };
  }

  private normalizeSkillSource(skill: NonNullable<CapabilityIndexSources['skills']>[0]): CapabilityDescriptor {
    return {
      id: `skill:${skill.name}`,
      kind: 'skill',
      name: skill.name,
      displayName: skill.name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      description: skill.description,
      category: skill.category ?? 'general',
      tags: skill.tags ?? [],
      requiredSecrets: skill.requiredSecrets ?? [],
      requiredTools: skill.requiredTools ?? skill.metadata?.requires?.bins ?? [],
      available: true,
      fullContent: skill.content,
      sourceRef: {
        type: 'skill',
        skillName: skill.name,
        skillPath: skill.sourcePath,
      },
    };
  }

  private normalizeExtensionSource(ext: NonNullable<CapabilityIndexSources['extensions']>[0]): CapabilityDescriptor {
    return {
      id: `extension:${ext.name}`,
      kind: 'extension',
      name: ext.name,
      displayName: ext.displayName,
      description: ext.description,
      category: ext.category,
      tags: [],
      requiredSecrets: ext.requiredSecrets ?? [],
      requiredTools: [],
      available: ext.available ?? false,
      sourceRef: {
        type: 'extension',
        packageName: ext.name,
        extensionId: ext.id,
      },
    };
  }

  private normalizeChannelSource(ch: NonNullable<CapabilityIndexSources['channels']>[0]): CapabilityDescriptor {
    return {
      id: `channel:${ch.platform}`,
      kind: 'channel',
      name: ch.platform,
      displayName: ch.displayName,
      description: ch.description,
      category: 'communication',
      tags: ch.capabilities ?? [],
      requiredSecrets: [],
      requiredTools: [],
      available: true,
      sourceRef: { type: 'channel', platform: ch.platform },
    };
  }
}
