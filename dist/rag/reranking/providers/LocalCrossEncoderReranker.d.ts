/**
 * @fileoverview Local cross-encoder reranker using transformers.js or ONNX runtime.
 * Runs reranking models locally without external API calls.
 *
 * @module backend/agentos/rag/reranking/providers/LocalCrossEncoderReranker
 */
import type { IRerankerProvider, RerankerInput, RerankerOutput, RerankerRequestConfig, RerankerProviderConfig } from '../IRerankerService';
/**
 * Local reranker configuration.
 */
export interface LocalCrossEncoderConfig extends RerankerProviderConfig {
    providerId: 'local';
    /**
     * Model ID from Hugging Face Hub.
     * Default: 'cross-encoder/ms-marco-MiniLM-L-6-v2'
     */
    defaultModelId?: string;
    /**
     * Device to run inference on.
     * - 'cpu': Use CPU (default, most compatible)
     * - 'gpu': Use GPU if available (requires CUDA/WebGPU)
     * - 'auto': Automatically select best available
     */
    device?: 'cpu' | 'gpu' | 'auto';
    /**
     * Maximum sequence length for the model.
     * Default: 512
     */
    maxSequenceLength?: number;
    /**
     * Batch size for inference.
     * Default: 32
     */
    batchSize?: number;
    /**
     * Path to cache downloaded models.
     * Default: system cache directory
     */
    cacheDir?: string;
}
/**
 * Available local cross-encoder models (Hugging Face model IDs).
 */
export declare const LOCAL_RERANKER_MODELS: readonly ["cross-encoder/ms-marco-MiniLM-L-6-v2", "cross-encoder/ms-marco-MiniLM-L-12-v2", "BAAI/bge-reranker-base", "BAAI/bge-reranker-large", "sentence-transformers/ce-ms-marco-TinyBERT-L-4"];
export type LocalRerankerModel = (typeof LOCAL_RERANKER_MODELS)[number];
/**
 * Local cross-encoder reranker.
 *
 * Runs cross-encoder models locally using transformers.js for Node.js/browser
 * or ONNX runtime. No API calls, fully offline capable.
 *
 * **Performance**: ~200-500ms for 50 documents on CPU (varies by model/hardware)
 *
 * **Note**: First run downloads the model (~100-500MB depending on model).
 * Subsequent runs use cached model.
 *
 * @example
 * ```typescript
 * const reranker = new LocalCrossEncoderReranker({
 *   providerId: 'local',
 *   defaultModelId: 'cross-encoder/ms-marco-MiniLM-L-6-v2',
 *   device: 'cpu',
 *   batchSize: 32
 * });
 *
 * await reranker.initialize(); // Downloads model if not cached
 *
 * const result = await reranker.rerank(
 *   { query: 'machine learning', documents: [...] },
 *   { providerId: 'local', modelId: 'cross-encoder/ms-marco-MiniLM-L-6-v2' }
 * );
 * ```
 */
export declare class LocalCrossEncoderReranker implements IRerankerProvider {
    readonly providerId: "local";
    private readonly config;
    private pipeline;
    private isInitialized;
    private initializationPromise;
    constructor(config: LocalCrossEncoderConfig);
    /**
     * Initialize the model pipeline.
     * Call this before first use or let rerank() handle lazy initialization.
     */
    initialize(modelId?: string): Promise<void>;
    private _doInitialize;
    /**
     * Check if the local reranker is available.
     */
    isAvailable(): Promise<boolean>;
    /**
     * Get supported local reranker models.
     */
    getSupportedModels(): string[];
    /**
     * Rerank documents using a local cross-encoder model.
     */
    rerank(input: RerankerInput, config: RerankerRequestConfig): Promise<RerankerOutput>;
    /**
     * Unload the model from memory.
     * Call this when you're done with the reranker to free resources.
     */
    dispose(): Promise<void>;
}
//# sourceMappingURL=LocalCrossEncoderReranker.d.ts.map