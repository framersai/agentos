/**
 * @fileoverview Defines the contracts and shared types for the Retrieval Augmented Generation (RAG)
 * pipeline inside AgentOS.  The RetrievalAugmentor coordinates between embedding managers, vector
 * store managers, and higher level orchestration (GMI, personas) to ingest knowledge, retrieve
 * relevant context, and manage document lifecycles.
 *
 * @module backend/agentos/rag/IRetrievalAugmentor
 */
/**
 * Logical buckets that the RAG system can target.  These allow integrators to map different
 * document types or knowledge sources to distinct vector store data sources and policies.
 */
export var RagMemoryCategory;
(function (RagMemoryCategory) {
    RagMemoryCategory["PERSONAL_LLM_EXPERIENCE"] = "personal_llm_experience";
    RagMemoryCategory["USER_EXPLICIT_MEMORY"] = "user_explicit_memory";
    RagMemoryCategory["SHARED_KNOWLEDGE_BASE"] = "shared_knowledge_base";
    RagMemoryCategory["EPISODIC_CONTEXT"] = "episodic_context";
    RagMemoryCategory["GOAL_ORIENTED_MEMORY"] = "goal_oriented_memory";
})(RagMemoryCategory || (RagMemoryCategory = {}));
//# sourceMappingURL=IRetrievalAugmentor.js.map