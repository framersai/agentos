/**
 * @file LlmJudgeRecognizer.ts
 * @description Tier 4 LLM-powered judge that re-examines individual PII
 * entity candidates using a chain-of-thought (CoT) prompt.
 *
 * Unlike the other recognisers, this class does **not** implement
 * {@link IEntityRecognizer} because it operates on already-detected entities
 * rather than raw text.  Its primary entry point is
 * {@link LlmJudgeRecognizer.judge}, which takes a single {@link PiiEntity}
 * plus the surrounding full text and returns either a confirmed/reclassified
 * entity or `null` if the LLM determines the span is not PII.
 *
 * ### Key features
 * - **Chain-of-thought prompt**: Forces the LLM to reason before classifying,
 *   improving accuracy on ambiguous spans.
 * - **LRU cache**: Keyed by `(span_text, context_hash)` to avoid redundant
 *   calls for identical spans in similar contexts.
 * - **Semaphore**: Limits concurrent LLM requests to prevent rate-limit
 *   exhaustion on high-throughput agents.
 * - **Fail-open**: If the LLM call fails for any reason, the original entity
 *   is returned unchanged (conservative — prefer false positive over leak).
 *
 * @module pii-redaction/recognizers
 */

import type { PiiEntity, PiiEntityType, LlmJudgeConfig } from '../types';

// ---------------------------------------------------------------------------
// LRU cache implementation
// ---------------------------------------------------------------------------

/**
 * Simple LRU (Least Recently Used) cache backed by a `Map`.
 *
 * Leverages the insertion-order guarantee of ES2015 Maps: the least recently
 * used entry is always the first entry in iteration order.  On each `get`,
 * the entry is deleted and re-inserted to move it to the "most recent" end.
 *
 * @typeParam V - The cached value type.
 */
class LruCache<V> {
  /** Internal ordered map storage. */
  private readonly map = new Map<string, V>();

  /** Maximum number of entries before the oldest is evicted. */
  private readonly maxSize: number;

  /**
   * @param maxSize - Maximum cache capacity.
   */
  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  /**
   * Retrieve a cached value, promoting it to most-recently-used.
   *
   * @param key - Cache key.
   * @returns The cached value, or `undefined` if not present.
   */
  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;

    // Move to most-recently-used position by deleting and re-inserting.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /**
   * Insert or update a value, evicting the oldest entry if at capacity.
   *
   * @param key   - Cache key.
   * @param value - Value to cache.
   */
  set(key: string, value: V): void {
    // If the key already exists, delete it first to reset its position.
    if (this.map.has(key)) {
      this.map.delete(key);
    }

    this.map.set(key, value);

    // Evict the oldest entry if we've exceeded capacity.
    if (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value as string;
      this.map.delete(oldestKey);
    }
  }

  /** Current number of entries in the cache. */
  get size(): number {
    return this.map.size;
  }
}

// ---------------------------------------------------------------------------
// Semaphore implementation
// ---------------------------------------------------------------------------

/**
 * Counting semaphore for limiting concurrent async operations.
 *
 * Callers {@link acquire} a permit before starting work and {@link release}
 * it when done.  If all permits are taken, `acquire()` returns a promise
 * that resolves once a permit becomes available.
 */
class Semaphore {
  /** Number of currently available permits. */
  private permits: number;

  /** Queue of waiters blocked on permit acquisition. */
  private readonly waiters: Array<() => void> = [];

  /**
   * @param maxConcurrency - Maximum number of simultaneous permits.
   */
  constructor(maxConcurrency: number) {
    this.permits = maxConcurrency;
  }

  /**
   * Acquire a permit.  Resolves immediately if a permit is available,
   * otherwise blocks until one is released.
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    // No permits available — queue a waiter.
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /**
   * Release a permit, waking the next queued waiter if any.
   */
  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the permit directly to the next waiter.
      next();
    } else {
      this.permits++;
    }
  }
}

// ---------------------------------------------------------------------------
// LLM response types
// ---------------------------------------------------------------------------

/**
 * Expected JSON structure in the LLM's response content.
 */
interface LlmJudgement {
  /** Whether the span contains PII. */
  isPii: boolean;
  /**
   * The entity type classification from the LLM.
   * When `isPii` is `false`, this is typically `'NOT_PII'`.
   */
  entityType: string;
  /** Confidence score from the LLM (0–1). */
  confidence: number;
  /** Chain-of-thought reasoning explaining the classification. */
  reasoning: string;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * System prompt that instructs the LLM to perform chain-of-thought PII
 * classification.  The prompt requests a strict JSON response format.
 */
const SYSTEM_PROMPT = `You are a PII (Personally Identifiable Information) classification expert.

Your task: given a text span that was flagged as potential PII, determine whether it truly contains PII that should be redacted.

Think step-by-step:
1. What is the span text?
2. What is the surrounding context?
3. Is this genuinely identifying information about a real person, or is it generic/fictional/public knowledge?
4. What specific PII type does it represent?

Respond with ONLY a valid JSON object (no markdown, no explanation outside the JSON):
{
  "isPii": true/false,
  "entityType": "PERSON" | "ORGANIZATION" | "LOCATION" | "EMAIL" | "PHONE" | "SSN" | "CREDIT_CARD" | "IP_ADDRESS" | "DATE_OF_BIRTH" | "API_KEY" | "AWS_KEY" | "CRYPTO_ADDRESS" | "IBAN" | "PASSPORT" | "DRIVERS_LICENSE" | "GOV_ID" | "MEDICAL_TERM" | "UNKNOWN_PII" | "NOT_PII",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of your classification"
}`;

// ---------------------------------------------------------------------------
// Fetch type (injectable for testing)
// ---------------------------------------------------------------------------

/**
 * Minimal fetch-compatible function signature.  Allows injection of a mock
 * fetch in tests without depending on the global `fetch` or any HTTP library.
 */
type FetchFn = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

// ---------------------------------------------------------------------------
// LlmJudgeRecognizer
// ---------------------------------------------------------------------------

/**
 * Tier 4 LLM-powered judge that confirms or reclassifies individual PII
 * entity candidates using chain-of-thought reasoning.
 *
 * ### Usage pattern
 * ```ts
 * const judge = new LlmJudgeRecognizer(config);
 * const result = await judge.judge(candidateEntity, fullText);
 * if (result === null) {
 *   // LLM says it's not PII — discard the candidate.
 * } else {
 *   // Use the confirmed/reclassified entity.
 * }
 * ```
 *
 * ### Caching
 * Results are cached by a composite key of the span text and a hash of
 * the surrounding context.  This means identical spans in similar contexts
 * won't trigger redundant LLM calls.
 *
 * ### Concurrency control
 * A counting semaphore limits the number of in-flight LLM requests to
 * {@link LlmJudgeConfig.maxConcurrency} (default 3), preventing rate-limit
 * errors when many entities are judged in parallel.
 *
 * ### Failure mode
 * The judge is **fail-open**: if the LLM call fails (network error, invalid
 * response, timeout), the original entity is returned unchanged.  This is
 * the conservative choice — a false positive (over-redaction) is preferable
 * to leaking real PII.
 */
export class LlmJudgeRecognizer {
  /** Human-readable name for logging/diagnostics. */
  public readonly name = 'LlmJudgeRecognizer';

  /** The LLM judge configuration. */
  private readonly config: LlmJudgeConfig;

  /** LRU cache keyed by `(span_text, context_hash)`. */
  private readonly cache: LruCache<PiiEntity | null>;

  /** Semaphore to limit concurrent LLM requests. */
  private readonly semaphore: Semaphore;

  /** Injectable fetch implementation (defaults to global fetch). */
  private readonly fetchImpl: FetchFn;

  /**
   * Construct a new LlmJudgeRecognizer.
   *
   * @param config    - LLM provider/model configuration.
   * @param fetchImpl - Optional injectable fetch function for testing.
   *                    Defaults to the global `fetch`.
   */
  constructor(config: LlmJudgeConfig, fetchImpl?: FetchFn) {
    this.config = config;
    this.cache = new LruCache(config.cacheSize ?? 256);
    this.semaphore = new Semaphore(config.maxConcurrency ?? 3);
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as unknown as FetchFn);
  }

  /**
   * Judge a single PII entity candidate in context.
   *
   * @param entity   - The candidate entity to evaluate.
   * @param fullText - The full text from which the entity was extracted,
   *                   providing the LLM with surrounding context.
   * @returns The confirmed/reclassified entity, or `null` if the LLM
   *          determines the span is not PII.
   */
  public async judge(entity: PiiEntity, fullText: string): Promise<PiiEntity | null> {
    // Build the cache key from the span text and a hash of the context.
    const cacheKey = this.buildCacheKey(entity.text, fullText);

    // Check cache first.
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // Acquire a semaphore permit to respect concurrency limits.
    await this.semaphore.acquire();

    try {
      // Build the user prompt with the span and its context.
      const userPrompt = this.buildUserPrompt(entity, fullText);

      // Call the LLM via OpenAI-compatible chat completions API.
      const judgement = await this.callLlm(userPrompt);

      // Process the LLM's judgement.
      const result = this.processJudgement(judgement, entity);

      // Cache the result.
      this.cache.set(cacheKey, result);

      return result;
    } catch {
      // Fail-open: if the LLM call fails, return the original entity
      // unchanged to avoid accidentally leaking PII.
      return entity;
    } finally {
      // Always release the semaphore permit.
      this.semaphore.release();
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Builds the cache key from the span text and a simple hash of the
   * surrounding context.
   *
   * The context hash uses a fast DJB2 hash — sufficient for cache-key
   * purposes without requiring a cryptographic hash function.
   *
   * @param spanText - The matched text span.
   * @param context  - The full surrounding text.
   * @returns A composite cache key string.
   */
  private buildCacheKey(spanText: string, context: string): string {
    const contextHash = this.djb2Hash(context);
    return `${spanText}::${contextHash}`;
  }

  /**
   * DJB2 hash function by Daniel J. Bernstein.
   * Fast, non-cryptographic hash suitable for hash-table keys.
   *
   * @param str - String to hash.
   * @returns Hex string representation of the hash.
   */
  private djb2Hash(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      // hash * 33 + charCode
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(16);
  }

  /**
   * Builds the user prompt containing the span text and its surrounding
   * context for the LLM to evaluate.
   *
   * @param entity   - The candidate entity.
   * @param fullText - The full text for context.
   * @returns The formatted user prompt string.
   */
  private buildUserPrompt(entity: PiiEntity, fullText: string): string {
    // Extract a window of context around the entity for the LLM.
    const contextWindow = 200; // characters on each side
    const ctxStart = Math.max(0, entity.start - contextWindow);
    const ctxEnd = Math.min(fullText.length, entity.end + contextWindow);
    const surroundingContext = fullText.slice(ctxStart, ctxEnd);

    return [
      `Span text: "${entity.text}"`,
      `Current classification: ${entity.entityType} (confidence: ${entity.score.toFixed(2)})`,
      `Source tier: ${entity.source}`,
      `Surrounding context: "${surroundingContext}"`,
    ].join('\n');
  }

  /**
   * Calls the LLM via OpenAI-compatible chat completions API.
   *
   * Uses raw `fetch` (no SDK dependency) to keep the extension lightweight
   * and to support any OpenAI-compatible endpoint (OpenRouter, vLLM, etc.).
   *
   * @param userPrompt - The user message content.
   * @returns Parsed LLM judgement response.
   * @throws If the API call fails or the response is not valid JSON.
   */
  private async callLlm(userPrompt: string): Promise<LlmJudgement> {
    const baseUrl = this.config.baseUrl ?? 'https://api.openai.com/v1';
    const apiKey = this.config.apiKey ?? '';

    const response = await this.fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1, // Low temperature for deterministic classification
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API returned status ${response.status}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    // Extract the content string from the chat completion response.
    const content = data.choices?.[0]?.message?.content ?? '';

    // Parse the JSON response, handling potential markdown fences.
    return this.parseJudgement(content);
  }

  /**
   * Parses the LLM's response content into a structured judgement object.
   *
   * Handles common LLM response quirks:
   * - Markdown code fences around JSON
   * - Leading/trailing whitespace
   *
   * @param content - Raw response content string from the LLM.
   * @returns Parsed {@link LlmJudgement}.
   * @throws If the content cannot be parsed as valid JSON.
   */
  private parseJudgement(content: string): LlmJudgement {
    // Strip markdown code fences if present.
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      // Remove opening fence (```json or ```)
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '');
      // Remove closing fence
      cleaned = cleaned.replace(/\s*```$/, '');
    }

    return JSON.parse(cleaned) as LlmJudgement;
  }

  /**
   * Processes the LLM's judgement and returns the appropriate result.
   *
   * - If the LLM says the span is NOT PII, returns `null`.
   * - If the LLM confirms PII, returns an updated entity with the LLM's
   *   classification and confidence, preserving the original values in
   *   metadata for audit.
   *
   * @param judgement - The parsed LLM response.
   * @param original  - The original candidate entity.
   * @returns Updated entity or `null`.
   */
  private processJudgement(
    judgement: LlmJudgement,
    original: PiiEntity,
  ): PiiEntity | null {
    // If the LLM says it's not PII, discard the entity.
    if (!judgement.isPii || judgement.entityType === 'NOT_PII') {
      return null;
    }

    // Map the LLM's entity type string to our PiiEntityType, falling back
    // to the original type if the LLM returns something unexpected.
    const newEntityType = this.mapLlmEntityType(judgement.entityType, original.entityType);

    return {
      entityType: newEntityType,
      text: original.text,
      start: original.start,
      end: original.end,
      score: judgement.confidence,
      source: 'llm',
      metadata: {
        ...original.metadata,
        llmReasoning: judgement.reasoning,
        llmModel: this.config.model,
        originalEntityType: original.entityType,
        originalScore: original.score,
        originalSource: original.source,
      },
    };
  }

  /**
   * Maps the LLM's entity type string to our {@link PiiEntityType}.
   *
   * If the LLM returns a recognised type string, it is used directly.
   * Otherwise, the original entity type is preserved.
   *
   * @param llmType  - Entity type string from the LLM response.
   * @param fallback - Original entity type to use as fallback.
   * @returns Resolved PiiEntityType.
   */
  private mapLlmEntityType(llmType: string, fallback: PiiEntityType): PiiEntityType {
    // List of all valid PiiEntityType values for validation.
    const validTypes: Set<string> = new Set([
      'SSN', 'CREDIT_CARD', 'EMAIL', 'PHONE', 'IP_ADDRESS', 'IBAN',
      'PASSPORT', 'DRIVERS_LICENSE', 'GOV_ID', 'DATE_OF_BIRTH', 'API_KEY',
      'AWS_KEY', 'CRYPTO_ADDRESS', 'PERSON', 'ORGANIZATION', 'LOCATION',
      'MEDICAL_TERM', 'UNKNOWN_PII',
    ]);

    if (validTypes.has(llmType)) {
      return llmType as PiiEntityType;
    }

    return fallback;
  }
}
