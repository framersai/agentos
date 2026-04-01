// File: backend/agentos/core/llm/providers/IProvider.ts
/**
 * @fileoverview Core provider contract and shared types for integrating Large Language / Multimodal Model services
 * into AgentOS. Implementations wrap concrete vendor SDKs or HTTP APIs (OpenAI, Anthropic, Ollama, OpenRouter, etc.)
 * and normalize their capabilities into a consistent surface area used by higher‑level orchestration layers
 * (PromptEngine, GMIManager, Utility AI components).
 *
 * Design Goals:
 * 1. Capability Normalization – Chat vs legacy completion, tool/function calling, streaming deltas, embeddings.
 * 2. Deterministic Streaming Semantics – Every streamed chunk is a full `ModelCompletionResponse` fragment with:
 *    - optional `responseTextDelta` (string diff)
 *    - optional `toolCallsDeltas[]` capturing incremental tool argument assembly
 *    - `isFinal` flag to indicate terminal chunk and stable usage metrics.
 * 3. Introspection – Lightweight model catalog (`listAvailableModels`, `getModelInfo`) enabling routing & cost decisions.
 * 4. Resilience & Diagnostics – Uniform error envelope attached to `ModelCompletionResponse.error` for both
 *    streaming and non‑streaming calls so upstream layers can surface actionable messages.
 * 5. Strict Initialization Lifecycle – `initialize()` must succeed before any other mutating call.
 *
 * Error Handling Philosophy:
 * - Provider implementations SHOULD translate vendor‑specific errors into a stable structure:
 *   { message, type?, code?, details? }.
 * - Transient failures (network timeouts, rate limit backoffs) MAY be surfaced inline; upstream retry policies live above.
 * - Streaming calls MUST emit a terminal chunk with `isFinal: true` even on error (with `error` populated) so consumers
 *   can perform consistent teardown.
 *
 * Concurrency & Cancellation:
 * - Implementations MAY support externally triggered abort via custom option (e.g. `customModelParams.abortSignal`).
 * - If supported, aborted streams MUST still resolve the generator cleanly (no thrown error) after emitting a final
 *   chunk with `isFinal: true` and an `error` describing the cancellation reason.
 *
 * Token Usage & Cost:
 * - `usage.totalTokens` MUST be present on final responses (streaming or non‑streaming).
 * - Interim streaming chunks SHOULD omit usage or provide partials; callers should treat usage as unstable until final.
 * - `costUSD` is optional; if provided should reflect estimated or actual vendor pricing for the call.
 *
 * @module backend/agentos/core/llm/providers/IProvider
 */
export {};
//# sourceMappingURL=IProvider.js.map