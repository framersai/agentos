/**
 * @fileoverview Identity-aware memory transplant pipeline.
 *
 * Sits between JsonExporter output and JsonImporter input. Classifies each
 * trace as player-fact, shared-experience, self-referential, or world-knowledge,
 * then filters and rewrites accordingly for cross-entity memory transfer.
 *
 * @module memory/io/MemoryTransplantPipeline
 */
export interface TransplantOptions {
    mode: 'heuristic' | 'llm';
    sourceIdentity?: {
        name: string;
        pronouns?: string;
    };
    llmInvoker?: (system: string, user: string) => Promise<string>;
}
export interface TransplantResult {
    transformedJson: string;
    transferred: number;
    filtered: number;
    rewritten: number;
    errors: string[];
}
export declare class MemoryTransplantPipeline {
    /**
     * Transform a brain JSON payload for cross-entity memory transfer.
     *
     * Classifies each trace, filters self-referential ones, rewrites shared
     * experiences, and re-tags survivors with transplant provenance.
     */
    static transform(brainJson: string, options: TransplantOptions): Promise<TransplantResult>;
}
//# sourceMappingURL=MemoryTransplantPipeline.d.ts.map