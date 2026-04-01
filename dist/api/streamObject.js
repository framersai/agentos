import { streamText } from './streamText.js';
import { lowerZodToJsonSchema } from '../orchestration/compiler/SchemaLowering.js';
import { ObjectGenerationError } from './generateObject.js';
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
/**
 * Builds the same schema-aware system prompt used by {@link generateObject}.
 *
 * Duplicated here to keep the streaming module self-contained without
 * exporting the helper from generateObject.
 *
 * @param userSystem - Optional user-supplied system prompt to prepend.
 * @param jsonSchema - JSON Schema representation of the Zod schema.
 * @param schemaName - Optional name for the schema.
 * @param schemaDescription - Optional description.
 * @returns The assembled system prompt.
 */
function buildSchemaSystemPrompt(userSystem, jsonSchema, schemaName, schemaDescription) {
    const parts = [];
    if (userSystem) {
        parts.push(userSystem);
        parts.push('');
    }
    parts.push('You MUST respond with ONLY a valid JSON object — no markdown, no code fences, no explanation.');
    if (schemaName) {
        parts.push(`The JSON object should be a "${schemaName}".`);
    }
    if (schemaDescription) {
        parts.push(schemaDescription);
    }
    parts.push('');
    parts.push('The JSON MUST conform to this JSON Schema:');
    parts.push(JSON.stringify(jsonSchema, null, 2));
    return parts.join('\n');
}
/**
 * Attempts to parse a partial JSON string by speculatively adding closing
 * brackets and braces.
 *
 * The LLM streams tokens incrementally, so at any point the buffer may be
 * an incomplete JSON string (e.g. `{"name":"Jo`). This function tries up to
 * 8 closing combinations to produce a parseable partial object.
 *
 * @param buffer - The accumulated JSON text so far.
 * @returns The parsed partial object, or `undefined` if no parse succeeded.
 */
function tryParsePartialJson(buffer) {
    const trimmed = buffer.trim();
    if (!trimmed)
        return undefined;
    // Fast path: maybe the buffer is already valid JSON
    try {
        return JSON.parse(trimmed);
    }
    catch {
        // Expected — the buffer is incomplete
    }
    // Strip any leading code fence marker that the model may have started
    let cleaned = trimmed;
    if (cleaned.startsWith('```json')) {
        cleaned = cleaned.slice(7).trim();
    }
    else if (cleaned.startsWith('```')) {
        cleaned = cleaned.slice(3).trim();
    }
    // Try progressively adding closing characters.
    // Count open braces/brackets that need closing.
    const closers = [];
    let inString = false;
    let escaped = false;
    for (const ch of cleaned) {
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString)
            continue;
        if (ch === '{')
            closers.push('}');
        else if (ch === '[')
            closers.push(']');
        else if (ch === '}' || ch === ']')
            closers.pop();
    }
    // If we're inside a string, close it first
    let candidate = cleaned;
    if (inString) {
        candidate += '"';
    }
    // Remove any trailing comma before we add closers (JSON doesn't allow trailing commas)
    candidate = candidate.replace(/,\s*$/, '');
    // Add the necessary closing characters in reverse order
    candidate += closers.reverse().join('');
    try {
        return JSON.parse(candidate);
    }
    catch {
        return undefined;
    }
}
/**
 * Extracts a JSON object from raw text, handling code fences and brace extraction.
 *
 * @param text - The complete raw text to parse.
 * @returns The parsed value.
 * @throws {SyntaxError} When no valid JSON can be extracted.
 */
function extractJson(text) {
    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed);
    }
    catch {
        // Fall through
    }
    const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch?.[1]) {
        return JSON.parse(fenceMatch[1].trim());
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new SyntaxError(`No valid JSON found in streamed response: ${trimmed.slice(0, 200)}`);
}
// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------
/**
 * Streams a structured object by incrementally parsing JSON as the LLM
 * produces tokens, then validates the final result against a Zod schema.
 *
 * Returns immediately with a {@link StreamObjectResult} containing async
 * iterables and promises. The underlying LLM call begins lazily when a
 * consumer starts iterating `partialObjectStream` or awaits a promise.
 *
 * @typeParam T - The Zod schema type. Partial objects are typed as
 *   `DeepPartial<z.infer<T>>`, and the final `object` promise resolves
 *   to `z.infer<T>`.
 *
 * @param opts - Streaming generation options including the Zod schema,
 *   prompt/messages, and optional provider/model overrides.
 * @returns A {@link StreamObjectResult} with `partialObjectStream`, `object`,
 *   `text`, and `usage` properties.
 *
 * @example
 * ```ts
 * import { z } from 'zod';
 * import { streamObject } from '@framers/agentos';
 *
 * const result = streamObject({
 *   model: 'openai:gpt-4o',
 *   schema: z.object({ name: z.string(), hobbies: z.array(z.string()) }),
 *   prompt: 'Create a profile for a fictional character.',
 * });
 *
 * for await (const partial of result.partialObjectStream) {
 *   console.log('partial:', partial);
 * }
 *
 * const final = await result.object;
 * console.log('final:', final);
 * ```
 *
 * @see {@link generateObject} for non-streaming structured output.
 * @see {@link streamText} for plain text streaming.
 */
export function streamObject(opts) {
    // Deferred promise resolvers — settled when the stream completes
    let resolveObject;
    let rejectObject;
    let resolveText;
    let resolveUsage;
    const objectPromise = new Promise((res, rej) => {
        resolveObject = res;
        rejectObject = rej;
    });
    const textPromise = new Promise((res) => {
        resolveText = res;
    });
    const usagePromise = new Promise((res) => {
        resolveUsage = res;
    });
    // Convert the Zod schema to JSON Schema for the system prompt
    const jsonSchema = lowerZodToJsonSchema(opts.schema);
    const systemPrompt = buildSchemaSystemPrompt(opts.system, jsonSchema, opts.schemaName, opts.schemaDescription);
    /**
     * The core async generator that drives the stream. It calls streamText()
     * under the hood and incrementally parses the accumulating JSON buffer,
     * yielding DeepPartial<T> snapshots as they become available.
     */
    async function* runPartialStream() {
        // Track the last successfully parsed partial to avoid duplicate yields
        let lastPartialJson = '';
        let buffer = '';
        const stream = streamText({
            provider: opts.provider,
            model: opts.model,
            system: systemPrompt,
            messages: opts.messages,
            prompt: opts.prompt,
            temperature: opts.temperature,
            maxTokens: opts.maxTokens,
            apiKey: opts.apiKey,
            baseUrl: opts.baseUrl,
        });
        try {
            for await (const chunk of stream.textStream) {
                buffer += chunk;
                // Attempt incremental parse on each token arrival
                const partial = tryParsePartialJson(buffer);
                if (partial !== undefined && typeof partial === 'object' && partial !== null) {
                    // Only yield when the parsed shape has actually changed
                    const serialized = JSON.stringify(partial);
                    if (serialized !== lastPartialJson) {
                        lastPartialJson = serialized;
                        yield partial;
                    }
                }
            }
            // Stream is complete — resolve the final values
            const finalText = buffer;
            resolveText(finalText);
            resolveUsage(await stream.usage);
            // Final parse and validation
            let parsed;
            try {
                parsed = extractJson(finalText);
            }
            catch (parseErr) {
                const err = new ObjectGenerationError(`Failed to parse streamed JSON: ${parseErr.message}`, finalText);
                rejectObject(err);
                return;
            }
            const validation = opts.schema.safeParse(parsed);
            if (validation.success) {
                resolveObject(validation.data);
            }
            else {
                rejectObject(new ObjectGenerationError(`Streamed JSON does not match schema: ${validation.error.message}`, finalText, validation.error));
            }
        }
        catch (err) {
            // Stream interrupted or errored — resolve promises so awaiting callers unblock
            const error = err instanceof Error ? err : new Error(String(err));
            resolveText(buffer);
            resolveUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
            rejectObject(new ObjectGenerationError(`Stream interrupted: ${error.message}`, buffer));
        }
    }
    return {
        partialObjectStream: runPartialStream(),
        object: objectPromise,
        text: textPromise,
        usage: usagePromise,
    };
}
//# sourceMappingURL=streamObject.js.map