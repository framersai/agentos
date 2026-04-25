/**
 * AgentOS ReadRouter Module
 *
 * Read-stage LLM-as-judge orchestrator that picks a reader strategy per
 * query+evidence pair. Sibling of {@link IngestRouter} (input-stage),
 * {@link MemoryRouter} (recall-stage), and the output-stage guardrails.
 *
 * @module @framers/agentos/read-router
 */

export type {
  ReadIntent,
  ReadStrategyId,
  ReadRouterPreset,
  ReadRoutingTable,
} from './routing-tables.js';
export { READ_INTENTS } from './routing-tables.js';

export type { ReadStrategyCostPoint } from './costs.js';

export type {
  ReadBudgetMode,
  ReadRouterConfig,
  ReadRoutingDecision,
} from './select-strategy.js';

export type {
  IReadIntentClassifier,
  IReadIntentClassifierLLM,
  ReadIntentClassifierLLMRequest,
  ReadIntentClassifierLLMResponse,
  ReadIntentClassifierClassifyOptions,
  ReadIntentClassifierResult,
  LLMReadIntentClassifierOptions,
} from './classifier.js';

export type {
  IReadDispatcher,
  ReadDispatchArgs,
  ReadDispatchResult,
  ReadStrategyExecutor,
  ReadStrategyRegistry,
} from './dispatcher.js';

export type {
  ReadBudgetPolicy,
  ReadRouterOptions,
  ReadRouterDecideOptions,
  ReadRouterDecision,
  ReadRouterDispatchedResult,
} from './ReadRouter.js';

export {
  PRECISE_FACT_TABLE,
  SYNTHESIS_TABLE,
  TEMPORAL_TABLE,
  PRESET_READ_TABLES,
} from './routing-tables.js';

export {
  SINGLE_CALL_COST,
  TWO_CALL_EXTRACT_ANSWER_COST,
  COMMIT_VS_ABSTAIN_COST,
  VERBATIM_CITATION_COST,
  SCRATCHPAD_COST,
  DEFAULT_READ_COSTS,
} from './costs.js';

export {
  selectReadStrategy,
  ReadRouterUnknownIntentError,
  ReadRouterBudgetExceededError,
} from './select-strategy.js';

export {
  READ_INTENT_CLASSIFIER_SYSTEM_PROMPT,
  READ_INTENT_CLASSIFIER_SYSTEM_PROMPT_FEWSHOT,
  SAFE_READ_INTENT_FALLBACK,
  LLMReadIntentClassifier,
  normalizeReadIntentClassifierOutput,
  parseReadIntentClassifierOutput,
} from './classifier.js';

export {
  FunctionReadDispatcher,
  UnsupportedReadStrategyError,
} from './dispatcher.js';

export {
  ReadRouter,
  ReadRouterDispatcherMissingError,
} from './ReadRouter.js';
