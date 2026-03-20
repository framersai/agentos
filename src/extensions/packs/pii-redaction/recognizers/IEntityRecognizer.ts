/**
 * @file IEntityRecognizer.ts
 * @description Internal interface contract for all PII entity recognisers used
 * within the detection pipeline.
 *
 * Each detection tier (regex, NER model, LLM judge, denylist) implements this
 * interface so the orchestrating {@link PiiDetectionService} can treat them
 * uniformly — iterating, filtering by capability, and composing results
 * without coupling to concrete implementations.
 *
 * @module pii-redaction/recognizers
 */

import type { PiiEntity, PiiEntityType } from '../types';

// ---------------------------------------------------------------------------
// RecognizeOptions
// ---------------------------------------------------------------------------

/**
 * Options passed to {@link IEntityRecognizer.recognize} on every call.
 *
 * Recognisers are encouraged (but not required) to honour all fields;
 * a recogniser that cannot make use of a field should silently ignore it
 * rather than throwing.
 */
export interface RecognizeOptions {
  /**
   * Subset of entity types the caller is interested in.
   * The recogniser SHOULD skip detection for types not in this list to avoid
   * redundant work.  If the array is empty or omitted the recogniser should
   * use its own default set (typically everything it supports).
   */
  entityTypes?: PiiEntityType[];

  /**
   * BCP-47 language tag of the input text (e.g. `'en'`, `'de'`, `'zh-Hans'`).
   * Recognisers that are language-sensitive (e.g. an NER model) use this to
   * select the correct model variant or pattern set.
   * @default `'en'`
   */
  language?: string;

  /**
   * Optional surrounding context provided by the caller — typically the full
   * conversation turn or document paragraph from which the input chunk was
   * extracted.  Recognisers (especially the LLM judge) may use this wider
   * context to resolve ambiguous spans more accurately.
   *
   * The context string is NOT itself subject to detection in this call; it is
   * purely informational.
   */
  context?: string;

  /**
   * Entities already discovered by previously-run recognisers in the same
   * pipeline pass.  A recogniser may use these to avoid emitting duplicate
   * spans, to improve confidence scoring on overlapping regions, or to skip
   * re-examining character ranges already confirmed by an earlier tier.
   */
  priorEntities?: PiiEntity[];
}

// ---------------------------------------------------------------------------
// IEntityRecognizer
// ---------------------------------------------------------------------------

/**
 * Contract that every entity recogniser in the PII detection pipeline must
 * satisfy.
 *
 * Recognisers are stateless with respect to individual calls: all per-call
 * configuration is passed via {@link RecognizeOptions}.  Long-lived state
 * (e.g. a loaded NER model, an LRU response cache) is kept in the
 * implementing class and initialised once at construction or on first use.
 *
 * ### Lifecycle
 * 1. The {@link PiiDetectionService} instantiates recognisers at pack startup.
 * 2. {@link recognize} is called once per input chunk for every detection pass.
 * 3. {@link dispose} is called when the pack is torn down (agent shutdown or
 *    hot-reload).  Implementations MUST release native resources (model
 *    handles, open file descriptors, HTTP keep-alive connections) here.
 *
 * @example Minimal regex-only recogniser
 * ```ts
 * class EmailRecognizer implements IEntityRecognizer {
 *   readonly name = 'EmailRecognizer';
 *   readonly supportedEntities: PiiEntityType[] = ['EMAIL'];
 *
 *   async recognize(input: string, options?: RecognizeOptions): Promise<PiiEntity[]> {
 *     const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
 *     const entities: PiiEntity[] = [];
 *     let m: RegExpExecArray | null;
 *     while ((m = EMAIL_RE.exec(input)) !== null) {
 *       entities.push({
 *         entityType: 'EMAIL',
 *         text: m[0],
 *         start: m.index,
 *         end: m.index + m[0].length,
 *         score: 1.0,
 *         source: 'regex',
 *       });
 *     }
 *     return entities;
 *   }
 *
 *   async dispose(): Promise<void> { /* nothing to release *\/ }
 * }
 * ```
 */
export interface IEntityRecognizer {
  /**
   * Human-readable name used in log messages and observability traces.
   * Should be unique within a running pipeline but is not enforced by the
   * registry.
   *
   * @example `'RegexRecognizer'`, `'SpacyNerRecognizer'`, `'OpenAiLlmJudge'`
   */
  readonly name: string;

  /**
   * The set of {@link PiiEntityType} values this recogniser is capable of
   * detecting.
   *
   * The {@link PiiDetectionService} uses this list to route detection work:
   * if the caller requests only `['EMAIL', 'PHONE']` and a recogniser's
   * `supportedEntities` has no overlap, the recogniser is skipped entirely for
   * that call.
   */
  readonly supportedEntities: PiiEntityType[];

  /**
   * Scan `input` for PII entities and return all matches above the
   * recogniser's internal confidence threshold.
   *
   * Implementations MUST:
   * - Return an empty array (never `null` or `undefined`) when no PII is found.
   * - Not mutate `input` or any object in `options.priorEntities`.
   * - Be safe to call concurrently from multiple async contexts (i.e. avoid
   *   shared mutable state that is not protected by a lock or queue).
   *
   * Implementations SHOULD:
   * - Respect `options.entityTypes` and skip patterns outside that set.
   * - Set `PiiEntity.source` to the appropriate tier identifier.
   * - Return overlapping spans only when they carry meaningfully different
   *   semantic labels; prefer the highest-confidence span otherwise.
   *
   * @param input - The raw text string to analyse.  May be a partial chunk
   *   when called from the streaming evaluator.
   * @param options - Per-call tuning parameters.  All fields are optional.
   * @returns A promise resolving to an array of detected {@link PiiEntity}
   *   objects, possibly empty.
   */
  recognize(input: string, options?: RecognizeOptions): Promise<PiiEntity[]>;

  /**
   * Release all resources held by this recogniser instance.
   *
   * Called by the {@link PiiDetectionService} during agent shutdown or when
   * the pack is dynamically unloaded.  After `dispose()` resolves, `recognize`
   * MUST NOT be called again; the behaviour is undefined if it is.
   *
   * Implementations that hold no resources may return a resolved promise
   * immediately: `async dispose() {}`.
   */
  dispose(): Promise<void>;
}
