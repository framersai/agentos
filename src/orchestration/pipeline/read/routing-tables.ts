/**
 * @file routing-tables.ts
 * @description Preset routing tables for {@link ReadRouter}.
 *
 * ReadRouter is the read-stage sibling of MemoryRouter (recall-stage)
 * and IngestRouter (input-stage). It picks a reader strategy after
 * retrieval has produced candidate evidence — single-call generation
 * vs two-call extract-then-answer (Emergence pattern) vs commit-vs-
 * abstain (explicit binary decision before answer) vs verbatim citation
 * vs scratchpad-then-answer (chain-of-thought-lite for temporal questions).
 *
 * @module @framers/agentos/read-router/routing-tables
 */

export const READ_INTENTS = [
  'precise-fact',
  'multi-source-synthesis',
  'time-interval',
  'preference-recommendation',
  'abstention-candidate',
] as const;

/**
 * Why the user is reading. Determines the optimal reader strategy.
 *
 * - `precise-fact`: a specific named entity / number / date is wanted.
 *   Reader should commit to a single best fact from the evidence.
 * - `multi-source-synthesis`: requires combining evidence from multiple
 *   chunks. Two-call extract-then-answer often beats single-call here.
 * - `time-interval`: durations / orderings / "how long ago" questions.
 *   Scratchpad-then-answer (compute interval inline before final answer)
 *   beats single-call on these.
 * - `preference-recommendation`: "any tips for X" / "do you have ideas".
 *   Reader must reference user-specific context from the evidence;
 *   single-call with a personalization rule works.
 * - `abstention-candidate`: question is likely unanswerable from the
 *   evidence (adversarial, off-topic). Commit-vs-abstain forces the
 *   reader to pick refuse-or-commit explicitly before generating prose.
 */
export type ReadIntent = (typeof READ_INTENTS)[number];

/**
 * Reader strategies. Different prompt scaffolds + call counts.
 *
 * - `single-call`: one reader.invoke call. Cheapest, fastest. Default
 *   for precise-fact and preference-recommendation intents.
 * - `two-call-extract-answer`: first call extracts relevant claims from
 *   evidence; second call answers using the extracted claims. Reduces
 *   distractor influence on multi-source synthesis. Emergence Simple
 *   pattern.
 * - `commit-vs-abstain`: an explicit upfront binary judgment ("can this
 *   evidence answer the question? yes/no") before generating prose.
 *   Reduces over-commit on abstention-candidate questions.
 * - `verbatim-citation`: appends a verbatim-citation rule to the system
 *   prompt for KU/SSU-style questions where the answer should be a
 *   direct quote from the evidence.
 * - `scratchpad-then-answer`: writes a short scratchpad before the final
 *   answer line. Best for temporal-reasoning where date arithmetic
 *   benefits from explicit reasoning.
 */
export type ReadStrategyId =
  | 'single-call'
  | 'two-call-extract-answer'
  | 'commit-vs-abstain'
  | 'verbatim-citation'
  | 'scratchpad-then-answer';

export type ReadRouterPreset =
  | 'precise-fact'
  | 'synthesis'
  | 'temporal';

export interface ReadRoutingTable {
  readonly preset: ReadRouterPreset;
  readonly defaultMapping: Readonly<Record<ReadIntent, ReadStrategyId>>;
}

/**
 * Preset: precise-fact (default for fact-recall workloads).
 *
 * Precise facts get single-call (cheap, accurate when evidence is clear).
 * Synthesis gets two-call extract-then-answer. Time intervals get
 * scratchpad. Preferences get single-call. Abstention candidates get the
 * explicit commit-vs-abstain decision.
 */
export const PRECISE_FACT_TABLE: ReadRoutingTable = Object.freeze({
  preset: 'precise-fact' as const,
  defaultMapping: Object.freeze({
    'precise-fact': 'single-call',
    'multi-source-synthesis': 'two-call-extract-answer',
    'time-interval': 'scratchpad-then-answer',
    'preference-recommendation': 'single-call',
    'abstention-candidate': 'commit-vs-abstain',
  }),
}) as ReadRoutingTable;

/**
 * Preset: synthesis (synthesis-heavy workloads).
 *
 * Routes more aggressively to two-call extract-then-answer for both
 * synthesis and precise-fact (the extract pass cleans up noisy evidence).
 * Verbatim citation for KU/SSU-style precise facts to reduce paraphrase
 * loss. Higher cost, higher fidelity.
 */
export const SYNTHESIS_TABLE: ReadRoutingTable = Object.freeze({
  preset: 'synthesis' as const,
  defaultMapping: Object.freeze({
    'precise-fact': 'verbatim-citation',
    'multi-source-synthesis': 'two-call-extract-answer',
    'time-interval': 'scratchpad-then-answer',
    'preference-recommendation': 'two-call-extract-answer',
    'abstention-candidate': 'commit-vs-abstain',
  }),
}) as ReadRoutingTable;

/**
 * Preset: temporal (time-heavy workloads).
 *
 * Almost everything goes through scratchpad-then-answer because the
 * scratchpad's date-arithmetic discipline transfers to non-temporal
 * questions about WHEN events happened.
 */
export const TEMPORAL_TABLE: ReadRoutingTable = Object.freeze({
  preset: 'temporal' as const,
  defaultMapping: Object.freeze({
    'precise-fact': 'scratchpad-then-answer',
    'multi-source-synthesis': 'scratchpad-then-answer',
    'time-interval': 'scratchpad-then-answer',
    'preference-recommendation': 'single-call',
    'abstention-candidate': 'commit-vs-abstain',
  }),
}) as ReadRoutingTable;

export const PRESET_READ_TABLES: Readonly<
  Record<ReadRouterPreset, ReadRoutingTable>
> = Object.freeze({
  'precise-fact': PRECISE_FACT_TABLE,
  synthesis: SYNTHESIS_TABLE,
  temporal: TEMPORAL_TABLE,
});
