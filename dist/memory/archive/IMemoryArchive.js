/**
 * @fileoverview Cold storage contract for verbatim memory content.
 *
 * The archive preserves original trace content before consolidation mechanisms
 * (temporal gist, lifecycle archival) overwrite or delete it. This enables
 * on-demand rehydration: lossy summaries in working context, lossless content
 * in cold storage, inflation driven by the LLM's own retrieval decisions.
 *
 * The archive is strictly write-ahead: any mechanism that would lose verbatim
 * content MUST call `store()` and await success before mutating the trace.
 * Archive writes that fail MUST abort the destructive operation.
 *
 * @module agentos/memory/archive/IMemoryArchive
 * @see {@link SqlStorageMemoryArchive} for the default implementation.
 * @see {@link ../../mechanisms/consolidation/TemporalGist} for the primary consumer.
 */
export {};
//# sourceMappingURL=IMemoryArchive.js.map