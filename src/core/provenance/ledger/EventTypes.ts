/**
 * @file EventTypes.ts
 * @description Typed event payload definitions for each ProvenanceEventType.
 * Provides helper functions for constructing well-typed event payloads.
 *
 * @module AgentOS/Provenance/Ledger
 */

import type { ProvenanceEventType } from '../types.js';

// =============================================================================
// Event Payload Interfaces
// =============================================================================

export interface GenesisPayload {
  agentId: string;
  seedPromptHash?: string;
  policySnapshot: Record<string, unknown>;
  publicKey: string;
}

export interface MessageCreatedPayload {
  conversationId: string;
  messageId: string;
  role: string;
  contentHash: string;
  timestamp: number;
}

export interface MessageRevisedPayload {
  conversationId: string;
  messageId: string;
  revisionNumber: number;
  previousContentHash: string;
  newContentHash: string;
}

export interface MessageTombstonedPayload {
  conversationId: string;
  messageId: string;
  reason: string;
  initiator: string;
}

export interface ConversationCreatedPayload {
  conversationId: string;
  userId?: string;
  gmiInstanceId?: string;
}

export interface ConversationArchivedPayload {
  conversationId: string;
}

export interface ConversationTombstonedPayload {
  conversationId: string;
  reason: string;
  initiator: string;
}

export interface ToolInvokedPayload {
  conversationId?: string;
  toolId: string;
  toolName: string;
  inputHash: string;
}

export interface ToolResultPayload {
  conversationId?: string;
  toolId: string;
  toolName: string;
  resultHash: string;
  success: boolean;
}

export interface MemoryStoredPayload {
  collectionId: string;
  documentId: string;
  contentHash: string;
  category?: string;
}

export interface MemoryRevisedPayload {
  collectionId: string;
  documentId: string;
  revisionNumber: number;
  previousContentHash: string;
  newContentHash: string;
}

export interface MemoryTombstonedPayload {
  collectionId: string;
  documentId: string;
  reason: string;
  initiator: string;
}

export interface ConfigChangedPayload {
  changedField: string;
  previousValueHash?: string;
  newValueHash: string;
}

export interface HumanInterventionPayload {
  interventionType: 'approval' | 'clarification' | 'edit' | 'escalation' | 'checkpoint' | 'pause' | 'stop';
  requestId?: string;
  decision?: string;
  details?: Record<string, unknown>;
}

export interface AnchorCreatedPayload {
  anchorId: string;
  merkleRoot: string;
  fromSequence: number;
  toSequence: number;
  eventCount: number;
  externalRef?: string;
}

export interface GuardrailTriggeredPayload {
  guardrailId?: string;
  action: 'allow' | 'flag' | 'sanitize' | 'block';
  reason?: string;
  reasonCode?: string;
  direction: 'input' | 'output';
}

// =============================================================================
// Payload Type Map
// =============================================================================

export interface ProvenancePayloadMap {
  genesis: GenesisPayload;
  'message.created': MessageCreatedPayload;
  'message.revised': MessageRevisedPayload;
  'message.tombstoned': MessageTombstonedPayload;
  'conversation.created': ConversationCreatedPayload;
  'conversation.archived': ConversationArchivedPayload;
  'conversation.tombstoned': ConversationTombstonedPayload;
  'tool.invoked': ToolInvokedPayload;
  'tool.result': ToolResultPayload;
  'memory.stored': MemoryStoredPayload;
  'memory.revised': MemoryRevisedPayload;
  'memory.tombstoned': MemoryTombstonedPayload;
  'config.changed': ConfigChangedPayload;
  'human.intervention': HumanInterventionPayload;
  'anchor.created': AnchorCreatedPayload;
  'guardrail.triggered': GuardrailTriggeredPayload;
}
