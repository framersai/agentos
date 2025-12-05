/**
 * @file index.ts
 * @description Agency module exports - multi-GMI collective management.
 *
 * The Agency module provides infrastructure for multi-agent collaboration:
 * - AgencyRegistry: Manages agency sessions and GMI seats
 * - AgencyMemoryManager: Shared RAG memory for cross-GMI context
 * - AgentCommunicationBus: Inter-agent messaging and coordination
 *
 * @module AgentOS/Agency
 */

// Types
export type {
  AgencySeatState,
  AgencySeatHistoryEntry,
  AgencyMemoryConfig,
  AgencyMemoryRetentionPolicy,
  AgencyMemoryScopingConfig,
  AgencySession,
  AgencyUpsertArgs,
  AgencySeatRegistrationArgs,
  AgencyMemoryOperationResult,
  AgencyMemoryQueryOptions,
} from './AgencyTypes';

// Registry
export { AgencyRegistry } from './AgencyRegistry';

// Memory Manager
export { AgencyMemoryManager } from './AgencyMemoryManager';
export type {
  AgencyMemoryIngestInput,
  AgencyMemoryChunk,
  AgencyMemoryQueryResult,
  AgencyMemoryStats,
} from './AgencyMemoryManager';

// Communication Bus
export { AgentCommunicationBus, type AgentCommunicationBusConfig } from './AgentCommunicationBus';
export type {
  IAgentCommunicationBus,
  AgentMessage,
  AgentMessageType,
  AgentRequest,
  AgentResponse,
  HandoffContext,
  HandoffResult,
  MessageHandler,
  Unsubscribe,
  SubscriptionOptions,
  MessageTopic,
  DeliveryStatus,
  RoutingConfig,
  BusStatistics,
  MessagePriority,
} from './IAgentCommunicationBus';




