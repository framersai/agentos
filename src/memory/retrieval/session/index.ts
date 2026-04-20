/**
 * @file index.ts
 * @description Barrel exports for session-level hierarchical
 * retrieval (Step 2 of the RAG stack sequenced rollout).
 *
 * @module agentos/memory/retrieval/session
 */

export { SessionSummaryStore } from './SessionSummaryStore.js';
export type {
  SessionSummaryStoreOptions,
  IndexSessionInput,
  QueriedSession,
} from './SessionSummaryStore.js';

export { SessionRetriever } from './SessionRetriever.js';
export type {
  SessionRetrieverOptions,
  SessionRetrieveOptions,
} from './SessionRetriever.js';
