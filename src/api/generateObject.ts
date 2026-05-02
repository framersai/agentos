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
import type { Message, SystemContentBlock, TokenUsage } from './generateText.js';
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
   *
   * Accepts a plain string (single system message) or an ordered array of
   * {@link SystemContentBlock} entries. When an array is supplied, caller
   * `cacheBreakpoint` flags are preserved on each block and a final
   * non-cached block is appended with the JSON schema + formatting rules.
   * This enables Anthropic prompt caching on the stable prefix while letting
   * the per-call schema vary freely.
   */
  system?: string | SystemContentBlock[];

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

  /**
   * Ordered fallback providers tried when the primary fails with a retryable
   * error. When undefined, auto-built from env keys. Pass `[]` to disable.
   * @see {@link import('./generateText.js').GenerateTextOptions.fallbackProviders}
   */
  fallbackProviders?: import('./generateText.js').FallbackProviderEntry[];

  /**
   * Called when a fallback provider is about to be tried.
   */
  onFallback?: (error: Error, fallbackProvider: string) => void;
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
 * Estimate the output-token budget needed to produce a complete JSON object
 * matching the given Zod schema. The estimate scales with field count and
 * nested-array shape so simple schemas use a small budget while nested-array
 * schemas (the historical truncation hot spot) get enough room to finish.
 *
 * Walks the Zod schema directly (handles both v3 internals via `_def.typeName`
 * and v4 internals via `_def.type`) so it works regardless of which Zod
 * version the consumer has installed.
 *
 * Returns a value clamped to [512, 8192]. Callers can override entirely by
 * passing `opts.maxTokens` to {@link generateObject}.
 */
function estimateMaxTokensForZodSchema(schema: any): number {
  const TOKENS_PER_LEAF = 30;       // average tokens per primitive field
  const TOKENS_PER_ARRAY_ITEM = 60; // assumed per-element budget for typical strings
  const MIN_BUDGET = 512;
  const MAX_BUDGET = 8192;

  function walk(node: any, depth: number): number {
    if (!node || depth > 8) return TOKENS_PER_LEAF;
    const def = (node as any)?._def;
    if (!def) return TOKENS_PER_LEAF;

    // Zod v3 uses `_def.typeName` ("ZodObject", "ZodArray", ...).
    // Zod v4 uses `_def.type` ("object", "array", ...).
    const typeNameV3 = def.typeName as string | undefined;
    const typeV4 = def.type as string | undefined;
    const kind: string = typeNameV3 ?? (typeV4 ? `Zod${typeV4[0].toUpperCase()}${typeV4.slice(1)}` : '');

    switch (kind) {
      case 'ZodOptional':
      case 'ZodNullable':
      case 'ZodDefault':
      case 'ZodReadonly':
      case 'ZodEffects':
        return walk(def.innerType ?? def.schema, depth + 1);

      case 'ZodObject': {
        // Zod v3: shape is a function returning the shape object.
        // Zod v4: shape is the shape object directly.
        const shapeRaw = def.shape;
        const shape: Record<string, any> = typeof shapeRaw === 'function' ? shapeRaw() : shapeRaw ?? {};
        let sum = 64; // braces, commas, base structure overhead
        for (const key of Object.keys(shape)) {
          sum += key.length + 8;        // field name + JSON syntax
          sum += walk(shape[key], depth + 1);
        }
        return sum;
      }

      case 'ZodArray': {
        // v3 stores element on def.type (a Zod schema), v4 on def.element.
        const inner = def.element ?? def.type;
        const itemBudget = walk(inner, depth + 1);
        const innerKind = inner?._def?.typeName ?? inner?._def?.type;
        const isObjectItem = innerKind === 'ZodObject' || innerKind === 'object';
        const assumedCount = isObjectItem ? 6 : 8;
        return 24 + assumedCount * Math.max(itemBudget, TOKENS_PER_ARRAY_ITEM);
      }

      case 'ZodEnum':
      case 'ZodNativeEnum': {
        const values = def.values ?? Object.values(def.entries ?? {});
        const arr = Array.isArray(values) ? values : Object.values(values);
        return arr.length > 0 ? Math.max(...arr.map((v: unknown) => String(v).length)) + 4 : TOKENS_PER_LEAF;
      }

      case 'ZodLiteral':
        return String(def.value ?? '').length + 4;

      case 'ZodUnion':
      case 'ZodDiscriminatedUnion': {
        const opts = (def.options ?? []) as any[];
        return opts.length > 0 ? Math.max(...opts.map((o) => walk(o, depth + 1))) : TOKENS_PER_LEAF;
      }

      default:
        return TOKENS_PER_LEAF;
    }
  }

  const estimate = Math.ceil(walk(schema, 0) * 1.5); // 50% headroom for prose-heavy fields
  if (estimate < MIN_BUDGET) return MIN_BUDGET;
  if (estimate > MAX_BUDGET) return MAX_BUDGET;
  return estimate;
}

/**
 * Builds the schema-specific instruction text appended to every
 * generateObject call. Kept free of caller context so it can be composed
 * with either a plain string system prompt or a structured block array.
 */
function buildSchemaInstructionText(
  jsonSchema: Record<string, unknown>,
  schemaName?: string,
  schemaDescription?: string,
): string {
  const parts: string[] = [];
  parts.push('You MUST respond with ONLY a valid JSON object — no markdown, no code fences, no explanation.');
  if (schemaName) parts.push(`The JSON object should be a "${schemaName}".`);
  if (schemaDescription) parts.push(schemaDescription);
  parts.push('');
  parts.push('The JSON MUST conform to this JSON Schema:');
  parts.push(JSON.stringify(jsonSchema, null, 2));
  return parts.join('\n');
}

/**
 * Builds the system prompt passed to generateText.
 *
 * - String input: concatenates caller prompt with schema instructions and
 *   returns a single string (legacy behavior).
 * - `SystemContentBlock[]` input: preserves caller blocks and their
 *   `cacheBreakpoint` flags, then appends the schema instructions as a
 *   cached block. Placing `cacheBreakpoint` on the schema block maximizes
 *   the cached prefix length for repeat calls with the same schema, while
 *   the per-call prompt/messages still vary freely.
 */
function buildSchemaSystemPrompt(
  userSystem: string | SystemContentBlock[] | undefined,
  jsonSchema: Record<string, unknown>,
  schemaName?: string,
  schemaDescription?: string,
): string | SystemContentBlock[] {
  const schemaText = buildSchemaInstructionText(jsonSchema, schemaName, schemaDescription);

  if (Array.isArray(userSystem)) {
    return [...userSystem, { text: schemaText, cacheBreakpoint: true }];
  }

  const parts: string[] = [];
  if (userSystem) {
    parts.push(userSystem);
    parts.push('');
  }
  parts.push(schemaText);
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
// Retry feedback truncation
// ---------------------------------------------------------------------------

const MAX_FEEDBACK_BAD_RESPONSE_CHARS = 500;
const MAX_FEEDBACK_VALIDATION_ISSUES = 5;

/**
 * Truncates a bad LLM response for retry feedback to avoid prompt-token bloat.
 * @internal
 */
function summarizeBadResponse(text: string): string {
  if (text.length <= MAX_FEEDBACK_BAD_RESPONSE_CHARS) return text;
  return `${text.slice(0, MAX_FEEDBACK_BAD_RESPONSE_CHARS)}... (truncated, ${text.length - MAX_FEEDBACK_BAD_RESPONSE_CHARS} more chars)`;
}

/**
 * Truncates Zod validation errors for retry feedback.
 * @internal
 */
function summarizeZodErrors(error: ZodError): string {
  const issues = error.issues.slice(0, MAX_FEEDBACK_VALIDATION_ISSUES);
  const lines = issues.map(i => `- ${i.path.join('.') || '<root>'}: ${i.message}`);
  if (error.issues.length > MAX_FEEDBACK_VALIDATION_ISSUES) {
    lines.push(`(${error.issues.length - MAX_FEEDBACK_VALIDATION_ISSUES} more issues omitted)`);
  }
  return lines.join('\n');
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

  // Auto-size the output budget when the caller didn't specify one. Without
  // this, complex nested schemas reliably truncate at the provider default
  // (256-512 tokens) and JSON.parse fails on the unfinished output. The
  // estimate scales with field count and array nesting depth so simple
  // schemas don't pay for tokens they won't use.
  const effectiveMaxTokens = opts.maxTokens ?? estimateMaxTokensForZodSchema(opts.schema);

  // Attempt generation up to 1 + maxRetries times (initial + retries)
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await generateText({
      provider: opts.provider,
      model: opts.model,
      system: systemPrompt,
      messages,
      temperature: opts.temperature,
      maxTokens: effectiveMaxTokens,
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      fallbackProviders: opts.fallbackProviders,
      onFallback: opts.onFallback,
      _responseFormat: supportsJsonMode ? { type: 'json_object' } : undefined,
    });

    // Accumulate token usage across attempts
    totalUsage.promptTokens += result.usage.promptTokens;
    totalUsage.completionTokens += result.usage.completionTokens;
    totalUsage.totalTokens += result.usage.totalTokens;
    if (typeof result.usage.costUSD === 'number') {
      totalUsage.costUSD = (totalUsage.costUSD ?? 0) + result.usage.costUSD;
    }
    // Prompt-cache metrics. generateText propagates these from the
    // provider layer (Anthropic's cache_read_input_tokens /
    // cache_creation_input_tokens); without this accumulation every
    // generateObject caller saw usage.cacheReadTokens as undefined even
    // on hits, blinding cost trackers to prompt-cache savings.
    // Only set the aggregate when the provider actually reported a
    // value — leaving it undefined for OpenAI (whose auto-cache does
    // not surface per-call counters) so callers can distinguish
    // "not reported" from "zero hits".
    if (typeof result.usage.cacheReadTokens === 'number') {
      totalUsage.cacheReadTokens = (totalUsage.cacheReadTokens ?? 0) + result.usage.cacheReadTokens;
    }
    if (typeof result.usage.cacheCreationTokens === 'number') {
      totalUsage.cacheCreationTokens =
        (totalUsage.cacheCreationTokens ?? 0) + result.usage.cacheCreationTokens;
    }

    lastRawText = result.text;

    // Step 1: Try to extract JSON from the raw text
    let parsed: unknown;
    try {
      parsed = extractJson(result.text);
    } catch (parseErr) {
      // JSON extraction failed — append truncated feedback and retry
      if (attempt < maxRetries) {
        messages.push({ role: 'assistant', content: summarizeBadResponse(result.text) });
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
      // Append truncated feedback to avoid prompt-token bloat on retries
      messages.push({ role: 'assistant', content: summarizeBadResponse(result.text) });
      messages.push({
        role: 'user',
        content: `The JSON you produced does not match the required schema. Validation errors:\n${summarizeZodErrors(validation.error)}\n\nPlease fix the JSON and respond with ONLY a valid JSON object.`,
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
