/**
 * Memory graph — spreading activation, knowledge graph, and GraphRAG.
 *
 * Consolidates the former top-level knowledge/ module into the memory
 * subsystem where it belongs (knowledge graph is a memory backend).
 *
 * @module agentos/memory/graph
 */
// Memory graph interfaces and implementations
export * from './IMemoryGraph.js';
export { GraphologyMemoryGraph } from './GraphologyMemoryGraph.js';
export { KnowledgeGraphMemoryGraph } from './KnowledgeGraphMemoryGraph.js';
export { spreadActivation } from './SpreadingActivation.js';
// Knowledge graph (absorbed from knowledge/)
export * from './knowledge/IKnowledgeGraph.js';
export { KnowledgeGraph } from './knowledge/KnowledgeGraph.js';
export { Neo4jKnowledgeGraph } from './knowledge/Neo4jKnowledgeGraph.js';
export { SqliteKnowledgeGraph } from './knowledge/SqliteKnowledgeGraph.js';
// GraphRAG
export * from './graphrag/index.js';
// Neo4j utilities
export * from './neo4j/index.js';
//# sourceMappingURL=index.js.map