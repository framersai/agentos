/**
 * @file embedText.ts
 * Provider-agnostic text embedding generation for the AgentOS high-level API.
 *
 * Dispatches embedding requests to OpenAI-compatible, Ollama, or OpenRouter
 * endpoints using the same provider resolution pipeline as {@link generateText}.
 * Supports single and batch text inputs, optional dimensionality reduction,
 * and returns raw float vectors.
 *
 * @see {@link generateText} for the text generation primitive.
 * @see {@link resolveModelOption} for model resolution with `TaskType = 'embedding'`.
 */
import { resolveModelOption, resolveProvider } from './model.js';
import { attachUsageAttributes, toTurnMetricUsage } from './observability.js';
import { recordAgentOSUsage } from './runtime/usageLedger.js';
import { recordAgentOSTurnMetrics, withAgentOSSpan } from '../evaluation/observability/otel.js';
// ---------------------------------------------------------------------------
// Provider dispatch helpers
// ---------------------------------------------------------------------------
/**
 * Calls the OpenAI-compatible `/v1/embeddings` endpoint.
 *
 * Works for OpenAI native, OpenRouter, and any API that follows the
 * same request/response contract.
 *
 * @param baseUrl - The API base URL (e.g. `https://api.openai.com/v1`).
 * @param apiKey - Bearer token for the Authorization header.
 * @param modelId - The embedding model identifier.
 * @param input - Array of strings to embed.
 * @param dimensions - Optional dimensionality reduction hint.
 * @returns Parsed {@link OpenAIEmbeddingResponse}.
 * @throws {Error} On non-2xx HTTP status or network failure.
 */
async function callOpenAIEmbedding(baseUrl, apiKey, modelId, input, dimensions) {
    // Construct the request body, omitting `dimensions` when not specified
    // to avoid confusing models that don't support it.
    const body = { model: modelId, input };
    if (dimensions !== undefined) {
        body.dimensions = dimensions;
    }
    const url = `${baseUrl.replace(/\/+$/, '')}/embeddings`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '(no body)');
        throw new Error(`Embedding request failed (${response.status}): ${text}`);
    }
    return response.json();
}
/**
 * Calls the Ollama `/api/embed` endpoint.
 *
 * Ollama uses a different request shape than OpenAI: input is passed as a
 * top-level `input` field (string or string[]), and the response has
 * `embeddings` at the top level.
 *
 * @param baseUrl - The Ollama API base URL (e.g. `http://localhost:11434`).
 * @param modelId - The Ollama model name (e.g. `nomic-embed-text`).
 * @param input - Array of strings to embed.
 * @returns Parsed {@link OllamaEmbedResponse}.
 * @throws {Error} On non-2xx HTTP status or network failure.
 */
async function callOllamaEmbed(baseUrl, modelId, input) {
    const url = `${baseUrl.replace(/\/+$/, '')}/api/embed`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId, input }),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '(no body)');
        throw new Error(`Ollama embed request failed (${response.status}): ${text}`);
    }
    return response.json();
}
// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------
/**
 * Generates embedding vectors for one or more text inputs using a
 * provider-agnostic `provider:model` string.
 *
 * Resolves credentials via the standard AgentOS provider pipeline, then
 * dispatches to the appropriate embedding endpoint (OpenAI, Ollama, or
 * OpenRouter). Returns raw float arrays suitable for vector similarity
 * search, clustering, or any downstream ML pipeline.
 *
 * @param opts - Embedding options including model, input text(s), and
 *   optional provider/key overrides.
 * @returns A promise resolving to the embedding vectors, provider metadata,
 *   and token usage.
 *
 * @throws {Error} When provider resolution fails (missing API key, unknown
 *   provider, etc.).
 * @throws {Error} When the embedding API returns a non-2xx status.
 *
 * @example
 * ```ts
 * import { embedText } from '@framers/agentos';
 *
 * // Single input
 * const { embeddings } = await embedText({
 *   model: 'openai:text-embedding-3-small',
 *   input: 'Hello world',
 * });
 * console.log(embeddings[0].length); // 1536
 *
 * // Batch with reduced dimensions
 * const batch = await embedText({
 *   model: 'openai:text-embedding-3-small',
 *   input: ['Hello', 'World'],
 *   dimensions: 256,
 * });
 * console.log(batch.embeddings.length); // 2
 * console.log(batch.embeddings[0].length); // 256
 * ```
 *
 * @see {@link generateText} for text generation.
 * @see {@link resolveModelOption} for provider auto-detection behaviour.
 */
export async function embedText(opts) {
    const startedAt = Date.now();
    let metricStatus = 'ok';
    let metricProviderId;
    let metricModelId;
    let metricUsage;
    try {
        return await withAgentOSSpan('agentos.api.embed_text', async (span) => {
            // Resolve provider/model using the 'embedding' task type so the
            // correct default model is selected (e.g. text-embedding-3-small).
            const { providerId, modelId } = resolveModelOption(opts, 'embedding');
            const resolved = resolveProvider(providerId, modelId, {
                apiKey: opts.apiKey,
                baseUrl: opts.baseUrl,
            });
            metricProviderId = resolved.providerId;
            metricModelId = resolved.modelId;
            span?.setAttribute('llm.provider', resolved.providerId);
            span?.setAttribute('llm.model', resolved.modelId);
            // Normalise input to an array for uniform handling downstream
            const inputArray = Array.isArray(opts.input) ? opts.input : [opts.input];
            span?.setAttribute('agentos.api.embed_input_count', inputArray.length);
            let embeddings;
            let reportedModel;
            let usage;
            if (resolved.providerId === 'ollama') {
                // Ollama uses its own /api/embed endpoint format
                const baseUrl = resolved.baseUrl ?? 'http://localhost:11434';
                const result = await callOllamaEmbed(baseUrl, resolved.modelId, inputArray);
                embeddings = result.embeddings;
                reportedModel = result.model;
                // Ollama doesn't report token usage for embeddings
                usage = { promptTokens: 0, totalTokens: 0 };
            }
            else {
                // OpenAI, OpenRouter, and any OpenAI-compatible provider
                const baseUrl = resolved.baseUrl ?? (resolved.providerId === 'openrouter'
                    ? 'https://openrouter.ai/api/v1'
                    : 'https://api.openai.com/v1');
                if (!resolved.apiKey) {
                    throw new Error(`No API key available for embedding provider "${resolved.providerId}".`);
                }
                const result = await callOpenAIEmbedding(baseUrl, resolved.apiKey, resolved.modelId, inputArray, opts.dimensions);
                // Sort by index to guarantee order matches input order
                // (the API contract already guarantees this, but defensive coding)
                const sorted = [...result.data].sort((a, b) => a.index - b.index);
                embeddings = sorted.map((d) => d.embedding);
                reportedModel = result.model;
                usage = {
                    promptTokens: result.usage.prompt_tokens,
                    totalTokens: result.usage.total_tokens,
                };
            }
            metricUsage = usage;
            span?.setAttribute('agentos.api.embed_dimensions', embeddings[0]?.length ?? 0);
            attachUsageAttributes(span, {
                promptTokens: usage.promptTokens,
                totalTokens: usage.totalTokens,
            });
            return {
                embeddings,
                model: reportedModel,
                provider: resolved.providerId,
                usage,
            };
        });
    }
    catch (error) {
        metricStatus = 'error';
        throw error;
    }
    finally {
        // Best-effort usage persistence and metrics recording
        try {
            await recordAgentOSUsage({
                providerId: metricProviderId,
                modelId: metricModelId,
                usage: metricUsage ? {
                    promptTokens: metricUsage.promptTokens,
                    completionTokens: 0,
                    totalTokens: metricUsage.totalTokens,
                } : undefined,
                options: {
                    ...opts.usageLedger,
                    source: opts.usageLedger?.source ?? 'embedText',
                },
            });
        }
        catch {
            // Helper-level usage persistence is best-effort and should not break embedding.
        }
        recordAgentOSTurnMetrics({
            durationMs: Date.now() - startedAt,
            status: metricStatus,
            usage: toTurnMetricUsage(metricUsage ? {
                promptTokens: metricUsage.promptTokens,
                completionTokens: 0,
                totalTokens: metricUsage.totalTokens,
            } : undefined),
        });
    }
}
//# sourceMappingURL=embedText.js.map