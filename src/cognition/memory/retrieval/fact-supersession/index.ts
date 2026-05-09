/**
 * @module agentos/memory/retrieval/fact-supersession
 * @description Post-retrieval LLM-based supersession filter — drops
 * memory traces whose factual claims have been superseded by later
 * traces about the same subject. Used to push knowledge-update
 * accuracy past the ceiling hit by pure retrieval + rerank.
 */
export { FactSupersession } from './FactSupersession.js';
export type {
  FactSupersessionOptions,
  FactSupersessionInput,
  FactSupersessionResult,
} from './FactSupersession.js';
