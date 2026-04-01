/**
 * A hook interface for persisting AgentOS rolling-memory outputs (`summary_markdown` + `memory_json`)
 * into an external long-term memory store (e.g., RAG, knowledge graph, database).
 *
 * AgentOS keeps the rolling summary inside the per-conversation `ConversationContext` metadata for
 * prompt compaction. This sink is for *cross-conversation* retrieval and analytics.
 */
export {};
//# sourceMappingURL=IRollingSummaryMemorySink.js.map