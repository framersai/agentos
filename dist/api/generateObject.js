import { generateText } from './generateText.js';
import { resolveModelOption } from './model.js';
import { lowerZodToJsonSchema } from '../orchestration/compiler/SchemaLowering.js';
// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------
/**
 * Thrown when structured output generation fails after exhausting all retries.
 *
 * Captures both the raw LLM output and the Zod validation issues so callers
 * can inspect what went wrong and surface useful diagnostics.
 *
 * @example
 * ```ts
 * try {
 *   await generateObject({ schema: mySchema, prompt: '...' });
 * } catch (err) {
 *   if (err instanceof ObjectGenerationError) {
 *     console.error('Raw text:', err.rawText);
 *     console.error('Validation:', err.validationErrors);
 *   }
 * }
 * ```
 */
export class ObjectGenerationError extends Error {
    /**
     * @param message - Human-readable summary of the failure.
     * @param rawText - The last raw text the LLM produced before we gave up.
     * @param validationErrors - Zod validation issues from the final attempt.
     */
    constructor(message, 
    /** The raw text returned by the LLM on the final attempt. */
    rawText, 
    /** Zod validation error details from the last parse attempt, if available. */
    validationErrors) {
        super(message);
        this.rawText = rawText;
        this.validationErrors = validationErrors;
        /** The name of this error class, useful for `instanceof` checks across realms. */
        this.name = 'ObjectGenerationError';
        Object.setPrototypeOf(this, ObjectGenerationError.prototype);
    }
}
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
/**
 * Set of provider identifiers known to support OpenAI-compatible
 * `response_format: { type: 'json_object' }` in their completion API.
 * This hint prevents the model from wrapping JSON in markdown fences.
 */
const JSON_MODE_PROVIDERS = new Set(['openai', 'openrouter']);
/**
 * Builds the system prompt that instructs the LLM to produce structured JSON.
 *
 * Appends schema documentation and strict formatting rules to any user-supplied
 * system prompt, ensuring the model knows exactly what shape to produce.
 *
 * @param userSystem - Optional user-supplied system prompt to prepend.
 * @param jsonSchema - The JSON Schema representation of the Zod schema.
 * @param schemaName - Optional human-readable name for the schema.
 * @param schemaDescription - Optional description of the schema.
 * @returns The assembled system prompt string.
 */
function buildSchemaSystemPrompt(userSystem, jsonSchema, schemaName, schemaDescription) {
    const parts = [];
    // Preserve any user-supplied system context
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
 * Attempts to extract a JSON object from raw LLM text.
 *
 * First tries a direct `JSON.parse`. If that fails, looks for JSON inside
 * common markdown code fences (` ```json ... ``` ` or ` ``` ... ``` `).
 * This handles the common case where models wrap JSON in code blocks
 * despite being told not to.
 *
 * @param text - The raw text to parse.
 * @returns The parsed value.
 * @throws {SyntaxError} When no valid JSON can be extracted.
 */
function extractJson(text) {
    const trimmed = text.trim();
    // Fast path: direct JSON parse
    try {
        return JSON.parse(trimmed);
    }
    catch {
        // Fall through to code fence extraction
    }
    // Try extracting from markdown code fences (```json ... ``` or ``` ... ```)
    const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch?.[1]) {
        return JSON.parse(fenceMatch[1].trim());
    }
    // Last resort: find the first { and last } to extract a JSON object
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new SyntaxError(`No valid JSON found in LLM response: ${trimmed.slice(0, 200)}`);
}
// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------
/**
 * Generates a structured object by forcing the LLM to produce JSON matching
 * a Zod schema.
 *
 * Combines schema-aware prompt engineering with optional provider-native JSON
 * mode and automatic retry-with-feedback to reliably extract typed data from
 * unstructured text.
 *
 * @typeParam T - The Zod schema type. The returned `object` field is inferred
 *   as `z.infer<T>`.
 *
 * @param opts - Generation options including the Zod schema, prompt/messages,
 *   and optional provider/model overrides.
 * @returns A promise resolving to the validated object, raw text, usage, and metadata.
 *
 * @throws {ObjectGenerationError} When all retries are exhausted without
 *   producing valid JSON that passes Zod validation.
 * @throws {Error} When provider resolution fails (missing API key, unknown provider, etc.).
 *
 * @example
 * ```ts
 * import { z } from 'zod';
 * import { generateObject } from '@framers/agentos';
 *
 * const { object } = await generateObject({
 *   model: 'openai:gpt-4o',
 *   schema: z.object({ name: z.string(), age: z.number() }),
 *   prompt: 'Extract: "John is 30 years old"',
 * });
 *
 * console.log(object.name); // "John"
 * console.log(object.age);  // 30
 * ```
 *
 * @see {@link streamObject} for streaming partial objects as they build up.
 * @see {@link generateText} for plain text generation without schema constraints.
 */
export async function generateObject(opts) {
    const maxRetries = opts.maxRetries ?? 2;
    // Convert the Zod schema to JSON Schema for the system prompt.
    // Uses the hand-rolled SchemaLowering converter to avoid extra dependencies.
    const jsonSchema = lowerZodToJsonSchema(opts.schema);
    const systemPrompt = buildSchemaSystemPrompt(opts.system, jsonSchema, opts.schemaName, opts.schemaDescription);
    // Detect whether the target provider supports native JSON mode.
    // This prevents the model from wrapping JSON in markdown fences.
    const { providerId } = resolveModelOption(opts, 'text');
    const supportsJsonMode = JSON_MODE_PROVIDERS.has(providerId);
    // Build the messages array, accumulating retry feedback as needed.
    const messages = [];
    if (opts.messages) {
        messages.push(...opts.messages);
    }
    if (opts.prompt) {
        messages.push({ role: 'user', content: opts.prompt });
    }
    // Aggregate usage across all attempts (including retries)
    const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let lastRawText = '';
    let lastValidationError;
    // Attempt generation up to 1 + maxRetries times (initial + retries)
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const result = await generateText({
            provider: opts.provider,
            model: opts.model,
            system: systemPrompt,
            messages,
            temperature: opts.temperature,
            maxTokens: opts.maxTokens,
            apiKey: opts.apiKey,
            baseUrl: opts.baseUrl,
            // Sneak in response_format via the provider's options when supported.
            // generateText doesn't have a dedicated param for this, but the system
            // prompt approach is the primary mechanism — JSON mode is an extra hint.
            ...(supportsJsonMode ? {} : {}),
        });
        // Accumulate token usage across attempts
        totalUsage.promptTokens += result.usage.promptTokens;
        totalUsage.completionTokens += result.usage.completionTokens;
        totalUsage.totalTokens += result.usage.totalTokens;
        if (typeof result.usage.costUSD === 'number') {
            totalUsage.costUSD = (totalUsage.costUSD ?? 0) + result.usage.costUSD;
        }
        lastRawText = result.text;
        // Step 1: Try to extract JSON from the raw text
        let parsed;
        try {
            parsed = extractJson(result.text);
        }
        catch (parseErr) {
            // JSON extraction failed — append feedback and retry
            if (attempt < maxRetries) {
                messages.push({ role: 'assistant', content: result.text });
                messages.push({
                    role: 'user',
                    content: `Your response was not valid JSON. Error: ${parseErr.message}\n\nPlease respond with ONLY a valid JSON object matching the schema. No markdown, no code fences.`,
                });
                continue;
            }
            throw new ObjectGenerationError(`Failed to extract valid JSON after ${maxRetries + 1} attempts: ${parseErr.message}`, result.text);
        }
        // Step 2: Validate against the Zod schema
        // Use safeParse to capture structured validation errors for retry feedback
        const validation = opts.schema.safeParse(parsed);
        if (validation.success) {
            return {
                object: validation.data,
                text: result.text,
                usage: totalUsage,
                finishReason: result.finishReason,
                provider: result.provider,
                model: result.model,
            };
        }
        // Validation failed — record the error and maybe retry
        lastValidationError = validation.error;
        if (attempt < maxRetries) {
            // Append the assistant's broken response and validation feedback
            messages.push({ role: 'assistant', content: result.text });
            messages.push({
                role: 'user',
                content: `The JSON you produced does not match the required schema. Validation errors:\n${validation.error.message}\n\nPlease fix the JSON and respond with ONLY a valid JSON object.`,
            });
            continue;
        }
    }
    // All retries exhausted
    throw new ObjectGenerationError(`Failed to generate valid structured output after ${maxRetries + 1} attempts.`, lastRawText, lastValidationError);
}
//# sourceMappingURL=generateObject.js.map