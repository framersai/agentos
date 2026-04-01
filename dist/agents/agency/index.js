/**
 * Agency module exports for multi-GMI collective management.
 *
 * The Agency module provides infrastructure for multi-agent collaboration:
 * - AgencyRegistry: Manages agency sessions and GMI seats
 * - AgencyMemoryManager: Shared RAG memory for cross-GMI context
 * - AgentCommunicationBus: Inter-agent messaging and coordination
 *
 * @module AgentOS/Agency
 */
// Registry
export { AgencyRegistry } from './AgencyRegistry.js';
// Memory Manager
export { AgencyMemoryManager } from './AgencyMemoryManager.js';
// Communication Bus
export { AgentCommunicationBus } from './AgentCommunicationBus.js';
//# sourceMappingURL=index.js.map