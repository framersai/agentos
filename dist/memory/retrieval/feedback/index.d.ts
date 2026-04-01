/**
 * @fileoverview Barrel export for the retrieval feedback subsystem.
 *
 * The feedback module provides:
 * - `RetrievalFeedbackSignal` — detects used vs ignored memory traces and
 *   persists those signals to the agent's SQLite brain.
 * - `RetrievalFeedback` — the typed event shape for a single feedback record.
 *
 * @module agentos/memory/feedback
 */
export { RetrievalFeedbackSignal } from './RetrievalFeedbackSignal.js';
export type { RetrievalFeedback } from './RetrievalFeedbackSignal.js';
//# sourceMappingURL=index.d.ts.map