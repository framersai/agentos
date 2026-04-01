/**
 * @fileoverview Capability Discovery Engine — main orchestrator.
 * @module @framers/agentos/discovery/CapabilityDiscoveryEngine
 *
 * Coordinates the capability index, relationship graph, and context assembler
 * to provide tiered, semantic capability discovery for AgentOS agents.
 *
 * Architecture:
 *   User Message → CapabilityIndex.search() → CapabilityGraph.rerank()
 *                → CapabilityContextAssembler.assemble() → CapabilityDiscoveryResult
 *
 * Performance targets:
 *   - Initialize: ~3s (one-time embedding generation for ~100 capabilities)
 *   - Per-turn discover(): ~50ms cold (embedding) / ~5ms warm (cache hit)
 *   - Context tokens: ~1,850 (down from ~20,000 with static dumps)
 */
import type { IEmbeddingManager } from '../core/embeddings/IEmbeddingManager.js';
import type { IVectorStore } from '../core/vector-store/IVectorStore.js';
import type { CapabilityDiscoveryConfig, CapabilityDiscoveryResult, CapabilityDescriptor, CapabilityIndexSources, DiscoveryQueryOptions, ICapabilityDiscoveryEngine, PresetCoOccurrence } from './types.js';
import type { EmergentTool } from '../emergent/types.js';
export declare class CapabilityDiscoveryEngine implements ICapabilityDiscoveryEngine {
    private readonly index;
    private readonly graph;
    private readonly assembler;
    private readonly config;
    private indexVersion;
    private initialized;
    constructor(embeddingManager: IEmbeddingManager, vectorStore: IVectorStore, config?: Partial<CapabilityDiscoveryConfig>);
    /**
     * Initialize the engine: build index + graph from all capability sources.
     *
     * After building from the provided sources, the engine also attempts to
     * load the auto-generated capability catalog from
     * `@framers/agentos-extensions-registry`. This rescues extensions that have
     * no SKILL.md and are not registered in the tool/channel/provider catalogs
     * by converting each catalog entry into a discoverable CapabilityDescriptor.
     *
     * The catalog import is non-fatal — if the registry package is not installed,
     * initialization proceeds with the explicit sources only.
     *
     * @param sources - Tools, skills, extensions, channels, and manifest entries
     * @param presetCoOccurrences - Co-occurrence data from agent presets
     */
    initialize(sources: CapabilityIndexSources, presetCoOccurrences?: PresetCoOccurrence[]): Promise<void>;
    /**
     * Discover capabilities relevant to a user message.
     *
     * Flow:
     * 1. Semantic search against capability embeddings
     * 2. Graph-based re-ranking (boost related capabilities)
     * 3. Token-budgeted tiered assembly
     *
     * Returns a CapabilityDiscoveryResult with Tier 0/1/2 context.
     */
    discover(userMessage: string, options?: DiscoveryQueryOptions): Promise<CapabilityDiscoveryResult>;
    /**
     * Get full detail for a specific capability by ID.
     */
    getCapabilityDetail(id: string): CapabilityDescriptor | undefined;
    /**
     * Refresh the index incrementally.
     * Called when manifest files change or new capabilities are added at runtime.
     */
    refreshIndex(sources?: Partial<CapabilityIndexSources>): Promise<void>;
    /**
     * Index emergent tools into the capability discovery system.
     *
     * Converts `EmergentTool` objects to `CapabilityDescriptor` records and
     * upserts them into the vector index and relationship graph. Session-tier tools
     * are skipped because they are too ephemeral to warrant indexing overhead.
     *
     * Each emergent tool becomes a descriptor with:
     * - `id: 'emergent-tool:${tool.name}'`
     * - `kind: 'emergent-tool'`
     * - `category: 'emergent'`
     * - `tags: ['runtime-created', 'agent-forged', implementation.mode]`
     * - `hasSideEffects: true` when the implementation mode is `'sandbox'`
     *
     * @param tools - Array of emergent tools to index. Session-tier entries are filtered out.
     * @returns The number of tools actually indexed (excluding skipped session-tier tools).
     */
    indexEmergentTools(tools: EmergentTool[]): Promise<number>;
    /**
     * Remove emergent tools from the discovery index.
     *
     * This is used when a promoted/shared tool is deactivated or revoked and
     * should no longer be returned by semantic capability discovery.
     */
    removeEmergentTools(tools: EmergentTool[]): Promise<number>;
    isInitialized(): boolean;
    /**
     * Get Tier 0 category summaries for all indexed capabilities.
     *
     * Returns a compact (~150 tokens) overview of available capability
     * categories, suitable for injection into LLM classification prompts.
     * This allows the classifier to reason about what capabilities exist
     * without loading full schemas.
     *
     * Returns an empty string when the engine is not initialized.
     *
     * @returns Tier 0 summary text, or empty string if uninitialized.
     *
     * @example
     * ```typescript
     * const summaries = engine.getTier0Summaries();
     * // "Available capability categories:\n- Information: web-search, deep-research (+2 more) (4)\n..."
     * ```
     */
    getTier0Summaries(): string;
    /**
     * Get Tier 0 category summaries filtered by capability kind.
     *
     * Produces separate summaries for skills, tools, and extensions so the
     * classifier can reason about each category independently.
     *
     * @returns Object with `skills`, `tools`, and `extensions` summary strings.
     */
    getTier0SummariesByKind(excludedCapabilityIds?: string[]): {
        skills: string;
        tools: string;
        extensions: string;
    };
    listCapabilityIds(): string[];
    /**
     * Get the current configuration.
     */
    getConfig(): Readonly<CapabilityDiscoveryConfig>;
    /**
     * Get index statistics.
     */
    getStats(): {
        capabilityCount: number;
        graphNodes: number;
        graphEdges: number;
        indexVersion: number;
    };
    /**
     * Render a discovery result into a string suitable for prompt injection.
     */
    renderForPrompt(result: CapabilityDiscoveryResult): string;
    /**
     * Load the auto-generated capability catalog from `@framers/agentos-extensions-registry`
     * and register each entry as a discoverable CapabilityDescriptor.
     *
     * This closes the "discovery gap" where extensions that lack SKILL.md files
     * and are not explicitly registered in tool/channel/provider catalogs remain
     * invisible to semantic search. The catalog is generated at build time from
     * all `manifest.json` files in the curated extensions directory.
     *
     * Only entries whose ID is NOT already in the index are added, so explicit
     * registrations from `CapabilityIndexSources` always take precedence.
     *
     * The import is dynamic and non-fatal: if `@framers/agentos-extensions-registry`
     * is not installed, the method silently returns zero.
     *
     * @returns The number of catalog entries injected into the index.
     */
    hydrateFromCapabilityCatalog(): Promise<number>;
    private emptyResult;
}
//# sourceMappingURL=CapabilityDiscoveryEngine.d.ts.map