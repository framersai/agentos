/**
 * @fileoverview IProvider implementation that invokes the Gemini CLI
 * as a subprocess, allowing users to leverage their Google account
 * (free / AI Pro / AI Ultra) without an API key. Completely separate
 * from the `gemini` provider (which uses GEMINI_API_KEY).
 *
 * @module agentos/core/llm/providers/implementations/GeminiCLIProvider
 * @see GeminiCLIBridge
 */
import { type IProvider, type ChatMessage, type ModelCompletionOptions, type ModelCompletionResponse, type ModelInfo, type ProviderEmbeddingOptions, type ProviderEmbeddingResponse } from '../IProvider';
/** Configuration for the Gemini CLI provider. */
export interface GeminiCLIProviderConfig {
    /** Override the default model. Defaults to `gemini-2.5-flash`. */
    defaultModelId?: string;
    /** Subprocess timeout in ms (default 120 000). */
    requestTimeout?: number;
}
/**
 * LLM provider that wraps the locally-installed Gemini CLI.
 * Users authenticate Gemini separately (via `gemini` in terminal);
 * this provider detects that installation and uses it for completions.
 *
 * No API key required — the user's Google account handles access.
 * `costUSD` is always 0 since there is no per-token charge.
 */
export declare class GeminiCLIProvider implements IProvider {
    readonly providerId: string;
    isInitialized: boolean;
    defaultModelId?: string;
    private config;
    private bridge;
    constructor();
    initialize(config: GeminiCLIProviderConfig): Promise<void>;
    shutdown(): Promise<void>;
    generateCompletion(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): Promise<ModelCompletionResponse>;
    generateCompletionStream(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): AsyncGenerator<ModelCompletionResponse, void, undefined>;
    generateEmbeddings(_modelId: string, _texts: string[], _options?: ProviderEmbeddingOptions): Promise<ProviderEmbeddingResponse>;
    listAvailableModels(): Promise<ModelInfo[]>;
    getModelInfo(modelId: string): Promise<ModelInfo | undefined>;
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: unknown;
    }>;
    private formatMessages;
    private serializeConversationXml;
    private contentPartsToText;
    private injectToolSchemas;
    private toolChoiceInstruction;
    private buildTextResponse;
    private buildToolCallResponse;
    private buildStreamErrorResponse;
    private buildUsage;
    private ensureInitialized;
}
//# sourceMappingURL=GeminiCLIProvider.d.ts.map