/**
 * Compatibility export for the SQLite-backed knowledge graph.
 *
 * The canonical implementation lives under `memory/retrieval/store/` because
 * it depends on `SqliteBrain` and the storage-adapter feature bundle. This
 * wrapper keeps the older `memory/retrieval/graph/knowledge/...` import path
 * working without maintaining a second copy of the class.
 */
export { SqliteKnowledgeGraph } from '../../store/SqliteKnowledgeGraph.js';
//# sourceMappingURL=SqliteKnowledgeGraph.js.map