/**
 * @fileoverview Pre-built pipeline configurations for common use cases.
 * @module agentos/nlp/presets
 */
import { TextProcessingPipeline } from './TextProcessingPipeline';
/**
 * Pipeline for English prose text.
 * Standard tokenizer → lowercase → strip accents → remove stop words → Porter stem.
 */
export declare function createProsePipeline(): TextProcessingPipeline;
/**
 * Pipeline for source code and technical identifiers.
 * Code tokenizer (camelCase/snake_case split) → lowercase → code stop words → no stemming.
 */
export declare function createCodePipeline(): TextProcessingPipeline;
/**
 * Default pipeline for RAG / hybrid search.
 * Standard tokenizer → lowercase → remove stop words → Porter stem.
 * Good balance of recall and precision for mixed-content corpora.
 */
export declare function createRagPipeline(): TextProcessingPipeline;
//# sourceMappingURL=presets.d.ts.map