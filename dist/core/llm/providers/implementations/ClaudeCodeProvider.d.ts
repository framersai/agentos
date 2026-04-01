/**
 * @fileoverview IProvider implementation that invokes the Claude Code CLI
 * as a subprocess, allowing users to leverage their personal Max subscription
 * without an API key. Completely separate from the `anthropic` provider
 * (which uses ANTHROPIC_API_KEY for pay-per-token access).
 *
 * Two-class architecture:
 * - **ClaudeCodeProvider** (this file) — IProvider contract, message formatting,
 *   tool schema injection, response mapping. Knows nothing about subprocesses.
 * - **ClaudeCodeCLIBridge** — subprocess lifecycle via execa. Knows nothing
 *   about LLM semantics.
 *
 * @module agentos/core/llm/providers/implementations/ClaudeCodeProvider
 * @see ClaudeCodeCLIBridge
 */
import { type IProvider, type ChatMessage, type ModelCompletionOptions, type ModelCompletionResponse, type ModelInfo, type ProviderEmbeddingOptions, type ProviderEmbeddingResponse } from '../IProvider';
/** Configuration for the Claude Code CLI provider. */
export interface ClaudeCodeProviderConfig {
    /** Override the default model. Defaults to `claude-sonnet-4-20250514`. */
    defaultModelId?: string;
    /** Subprocess timeout in ms (default 120 000). */
    requestTimeout?: number;
}
/**
 * LLM provider that wraps the locally-installed Claude Code CLI.
 * Users authenticate Claude Code separately (via `claude` in terminal);
 * this provider detects that installation and uses it for completions.
 *
 * No API key required — the user's Max subscription handles billing.
 * `costUSD` is always 0 since there is no per-token charge.
 */
export declare class ClaudeCodeProvider implements IProvider {
    readonly providerId: string;
    isInitialized: boolean;
    defaultModelId?: string;
    private config;
    private bridge;
    constructor();
    /**
     * Initialize the provider by verifying that Claude Code CLI is
     * installed and authenticated. Fails fast with actionable guidance
     * if either check fails.
     */
    initialize(config: ClaudeCodeProviderConfig): Promise<void>;
    /** Clean shutdown — marks provider as uninitialized. */
    shutdown(): Promise<void>;
    /**
     * Generate a single completion by spawning `claude --bare -p`.
     *
     * When `options.tools` is provided, tool schemas are injected into the
     * system prompt and `--json-schema` enforces structured output for
     * reliable tool call parsing. Falls back to text on parse failure.
     */
    generateCompletion(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): Promise<ModelCompletionResponse>;
    /**
     * Stream a completion by spawning `claude --bare -p --output-format stream-json`.
     *
     * Text-only turns get full token-by-token streaming. Tool-calling turns
     * stream progress events for UX feedback, then yield a single final
     * response with parsed tool calls.
     */
    generateCompletionStream(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): AsyncGenerator<ModelCompletionResponse, void, undefined>;
    /** Claude Code CLI does not support embeddings — throws immediately. */
    generateEmbeddings(_modelId: string, _texts: string[], _options?: ProviderEmbeddingOptions): Promise<ProviderEmbeddingResponse>;
    /** Returns the static Claude model catalog (Opus, Sonnet, Haiku). */
    listAvailableModels(): Promise<ModelInfo[]>;
    /** Look up a specific model by ID from the static catalog. */
    getModelInfo(modelId: string): Promise<ModelInfo | undefined>;
    /**
     * Structured health check for `wunderland doctor`.
     * Returns installation status, version, path, and auth state.
     */
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: unknown;
    }>;
    /**
     * Split ChatMessage[] into a system prompt string and a conversation
     * prompt serialized as XML.
     */
    private formatMessages;
    /**
     * Serialize non-system messages as XML for piping to Claude Code stdin.
     * Single user messages are passed through as plain text (no XML wrapper).
     */
    private serializeConversationXml;
    /** Convert MessageContentPart[] to plain text (best-effort). */
    private contentPartsToText;
    /**
     * Append tool schemas and calling instructions to the system prompt.
     * Tools are formatted as XML blocks that Claude handles natively.
     */
    private injectToolSchemas;
    /** Map toolChoice to a natural language instruction. */
    private toolChoiceInstruction;
    /** Build a text-only ModelCompletionResponse. */
    private buildTextResponse;
    /** Build a tool-call ModelCompletionResponse. */
    private buildToolCallResponse;
    /** Build a terminal streaming error chunk instead of throwing mid-stream. */
    private buildStreamErrorResponse;
    /** Convert raw usage from CLI bridge to ModelUsage. Always costUSD: 0. */
    private buildUsage;
    /** Guard — throws if provider is not initialized. */
    private ensureInitialized;
}
//# sourceMappingURL=ClaudeCodeProvider.d.ts.map