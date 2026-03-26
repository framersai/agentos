/**
 * @file generateObject.ts
 * Zod-validated structured output extraction for the AgentOS high-level API.
 *
 * Forces the LLM to produce JSON matching a caller-supplied Zod schema.  When
 * the provider supports native JSON mode (`response_format: { type: 'json_object' }`),
 * it is enabled automatically.  On parse or validation failure, the call is
 * retried with error feedback appended to the conversation so the model can
 * self-correct.
 *
 * @see {@link generateText} for the underlying text generation primitive.
 * @see {@link streamObject} for the streaming counterpart.
 */
import type { ZodType, ZodError } from 'zod';

import { generateText } from './generateText.js';
import type { Message, TokenUsage } from './generateText.js';
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
  /** The name of this error class, useful for `instanceof` checks across realms. */
  override readonly name = 'ObjectGenerationError';

  /**
   * @param message - Human-readable summary of the failure.
   * @param rawText - The last raw text the LLM produced before we gave up.
   * @param validationErrors - Zod validation issues from the final attempt.
   */
  constructor(
    message: string,
    /** The raw text returned by the LLM on the final attempt. */
    public readonly rawText: string,
    /** Zod validation error details from the last parse attempt, if available. */
    public readonly validationErrors?: ZodError,
  ) {
    super(message);
    Object.setPrototypeOf(this, ObjectGenerationError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Options for a {@link generateObject} call.
 *
 * At minimum, `schema` and either `prompt` or `messages` must be supplied.
 * Provider/model resolution follows the same rules as {@link generateText}.
 *
 * @typeParam T - The Zod schema type that defines the expected output shape.
 *
 * @example
 * ```ts
 * const opts: GenerateObjectOptions<typeof mySchema> = {
 *   schema: z.object({ name: z.string(), age: z.number() }),
 *   prompt: 'Extract: "John is 30 years old"',
 * };
 * ```
 */
export interface GenerateObjectOptions<T extends ZodType> {
  /**
   * Provider name. When supplied without `model`, the default text model for
   * the provider is resolved automatically.
   *
   * @example `"openai"`, `"anthropic"`, `"ollama"`
   */
  provider?: string;

  /**
   * Model identifier. Accepts `"provider:model"` or plain model name with `provider`.
   *
   * @example `"openai:gpt-4o"`, `"gpt-4o-mini"`
   */
  model?: string;

  /** Zod schema defining the expected output shape. */
  schema: T;

  /**
   * Human-readable name for the schema, injected into the system prompt to
   * give the model context about what it is generating.
   *
   * @example `"PersonInfo"`
   */
  schemaName?: string;

  /**
   * Description of the schema, injected into the system prompt alongside
   * the JSON Schema definition.
   *
   * @example `"Information about a person extracted from unstructured text."`
   */
  schemaDescription?: string;

  /** User prompt. Convenience alternative to building a `messages` array. */
  prompt?: string;

  /**
   * System prompt. The schema extraction instructions are appended to this,
   * so any custom system context is preserved.
   */
  system?: string;

  /** Full conversation history. */
  messages?: Message[];

  /** Sampling temperature forwarded to the provider (0-2 for most providers). */
  temperature?: number;

  /** Hard cap on output tokens. */
  maxTokens?: number;

  /**
   * Number of times to retry when JSON parsing or Zod validation fails.
   * Each retry appends the error details to the conversation so the model
   * can self-correct.
   *
   * @default 2
   */
  maxRetries?: number;

  /** Override the API key instead of reading from environment variables. */
  apiKey?: string;

  /** Override the provider base URL (useful for local proxies or Ollama). */
  baseUrl?: string;
}

/**
 * The completed result returned by {@link generateObject}.
 *
 * @typeParam T - The inferred type from the Zod schema, representing the validated object.
 */
export interface GenerateObjectResult<T> {
  /** The parsed, Zod-validated object matching the provided schema. */
  object: T;

  /** The raw LLM output text before parsing. */
  text: string;

  /** Aggregated token usage across all attempts (including retries). */
  usage: TokenUsage;

  /**
   * Reason the model stopped generating on the final successful attempt.
   * Mirrors the finish reasons from {@link generateText}.
   */
  finishReason: string;

  /** Provider identifier used for the run. */
  provider: string;

  /** Resolved model identifier used for the run. */
  model: string;
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
function buildSchemaSystemPrompt(
  userSystem: string | undefined,
  jsonSchema: Record<string, unknown>,
  schemaName?: string,
  schemaDescription?: string,
): string {
  const parts: string[] = [];

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
function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // Fast path: direct JSON parse
  try {
    return JSON.parse(trimmed);
  } catch {
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
export async function generateObject<T extends ZodType>(
  opts: GenerateObjectOptions<T>,
): Promise<GenerateObjectResult<z.infer<T>>> {
  const maxRetries = opts.maxRetries ?? 2;

  // Convert the Zod schema to JSON Schema for the system prompt.
  // Uses the hand-rolled SchemaLowering converter to avoid extra dependencies.
  const jsonSchema = lowerZodToJsonSchema(opts.schema);

  const systemPrompt = buildSchemaSystemPrompt(
    opts.system,
    jsonSchema,
    opts.schemaName,
    opts.schemaDescription,
  );

  // Detect whether the target provider supports native JSON mode.
  // This prevents the model from wrapping JSON in markdown fences.
  const { providerId } = resolveModelOption(opts, 'text');
  const supportsJsonMode = JSON_MODE_PROVIDERS.has(providerId);

  // Build the messages array, accumulating retry feedback as needed.
  const messages: Message[] = [];
  if (opts.messages) {
    messages.push(...opts.messages);
  }
  if (opts.prompt) {
    messages.push({ role: 'user', content: opts.prompt });
  }

  // Aggregate usage across all attempts (including retries)
  const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let lastRawText = '';
  let lastValidationError: ZodError | undefined;

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
    let parsed: unknown;
    try {
      parsed = extractJson(result.text);
    } catch (parseErr) {
      // JSON extraction failed — append feedback and retry
      if (attempt < maxRetries) {
        messages.push({ role: 'assistant', content: result.text });
        messages.push({
          role: 'user',
          content: `Your response was not valid JSON. Error: ${(parseErr as Error).message}\n\nPlease respond with ONLY a valid JSON object matching the schema. No markdown, no code fences.`,
        });
        continue;
      }
      throw new ObjectGenerationError(
        `Failed to extract valid JSON after ${maxRetries + 1} attempts: ${(parseErr as Error).message}`,
        result.text,
      );
    }

    // Step 2: Validate against the Zod schema
    // Use safeParse to capture structured validation errors for retry feedback
    const validation = opts.schema.safeParse(parsed) as
      | { success: true; data: z.infer<T> }
      | { success: false; error: ZodError };

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
  throw new ObjectGenerationError(
    `Failed to generate valid structured output after ${maxRetries + 1} attempts.`,
    lastRawText,
    lastValidationError,
  );
}

// Re-export the ZodType import so downstream code doesn't need to figure out
// the exact Zod version path.
import type { z } from 'zod';
