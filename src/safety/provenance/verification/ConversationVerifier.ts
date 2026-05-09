/**
 * @file ConversationVerifier.ts
 * @description Convenience verifier for conversation-level provenance checks.
 * Filters events by conversation ID and verifies the sub-chain.
 *
 * @module AgentOS/Provenance/Verification
 */

import type { SignedEvent, VerificationResult } from '../types.js';
import type { SignedEventLedger } from '../ledger/SignedEventLedger.js';
import { ChainVerifier } from './ChainVerifier.js';

// =============================================================================
// ConversationVerificationResult
// =============================================================================

export interface ConversationVerificationResult extends VerificationResult {
  conversationId: string;
  messageCount: number;
  hasGenesis: boolean;
  hasHumanInterventions: boolean;
  humanInterventionCount: number;
  isFullyAutonomous: boolean;
}

// =============================================================================
// ConversationVerifier
// =============================================================================

export class ConversationVerifier {
  private readonly ledger: SignedEventLedger;

  constructor(ledger: SignedEventLedger) {
    this.ledger = ledger;
  }

  /**
   * Verify the provenance chain for a specific conversation.
   *
   * @param conversationId - The conversation ID to verify.
   * @param publicKeyBase64 - Optional public key for signature verification.
   * @returns Detailed verification result including conversation-specific metadata.
   */
  async verifyConversation(
    conversationId: string,
    publicKeyBase64?: string,
  ): Promise<ConversationVerificationResult> {
    // Get all events related to this conversation
    const conversationEvents = await this.ledger.getEventsByPayloadFilter(
      { conversationId },
      undefined,
    );

    // Also check for events with table references to this conversation
    const messageEvents = await this.ledger.getEventsByPayloadFilter(
      { recordId: conversationId },
      ['conversation.created', 'conversation.archived', 'conversation.tombstoned'],
    );

    // Merge and deduplicate by event ID
    const eventMap = new Map<string, SignedEvent>();
    for (const e of [...conversationEvents, ...messageEvents]) {
      eventMap.set(e.id, e);
    }

    // Sort by sequence
    const events = [...eventMap.values()].sort((a, b) => a.sequence - b.sequence);

    // Run chain verification on the full ledger (not just conversation events)
    // because the hash chain spans all events
    const allEvents = await this.ledger.getAllEvents();
    const chainResult = await ChainVerifier.verify(allEvents, publicKeyBase64);

    // Conversation-specific analysis
    const messageCreated = events.filter(e => e.type === 'message.created');
    const humanInterventions = events.filter(e => e.type === 'human.intervention');
    const genesisEvents = allEvents.filter(e => e.type === 'genesis');

    return {
      ...chainResult,
      conversationId,
      messageCount: messageCreated.length,
      hasGenesis: genesisEvents.length > 0,
      hasHumanInterventions: humanInterventions.length > 0,
      humanInterventionCount: humanInterventions.length,
      isFullyAutonomous: genesisEvents.length > 0 && humanInterventions.length === 0,
    };
  }

  /**
   * Verify a single post/message within a conversation.
   * Checks that the message event exists and its chain position is valid.
   *
   * @param messageId - The message ID to verify.
   * @param publicKeyBase64 - Optional public key for signature verification.
   */
  async verifyMessage(
    messageId: string,
    publicKeyBase64?: string,
  ): Promise<VerificationResult & { messageId: string; found: boolean }> {
    // Find events referencing this message
    const events = await this.ledger.getEventsByPayloadFilter(
      { recordId: messageId },
    );

    if (events.length === 0) {
      return {
        valid: false,
        eventsVerified: 0,
        errors: [{
          eventId: '',
          sequence: 0,
          code: 'MESSAGE_NOT_FOUND',
          message: `No provenance events found for message '${messageId}'`,
        }],
        warnings: [],
        messageId,
        found: false,
        verifiedAt: new Date().toISOString(),
      };
    }

    // Verify the full chain to ensure these events are in a valid chain
    const allEvents = await this.ledger.getAllEvents();
    const chainResult = await ChainVerifier.verify(allEvents, publicKeyBase64);

    return {
      ...chainResult,
      messageId,
      found: true,
    };
  }

  /**
   * Get a summary of provenance status for a conversation.
   * Lighter than full verification - just counts and metadata.
   */
  async getProvenanceSummary(conversationId: string): Promise<{
    conversationId: string;
    totalEvents: number;
    messageEvents: number;
    revisionEvents: number;
    tombstoneEvents: number;
    humanInterventions: number;
    hasGenesis: boolean;
    chainLength: number;
    lastEventTimestamp: string | null;
  }> {
    const conversationEvents = await this.ledger.getEventsByPayloadFilter(
      { conversationId },
    );

    const allEvents = await this.ledger.getAllEvents();
    const latestEvent = await this.ledger.getLatestEvent();

    return {
      conversationId,
      totalEvents: conversationEvents.length,
      messageEvents: conversationEvents.filter(e => e.type === 'message.created').length,
      revisionEvents: conversationEvents.filter(e =>
        e.type === 'message.revised' || e.type === 'memory.revised'
      ).length,
      tombstoneEvents: conversationEvents.filter(e =>
        e.type === 'message.tombstoned' || e.type === 'memory.tombstoned' || e.type === 'conversation.tombstoned'
      ).length,
      humanInterventions: conversationEvents.filter(e => e.type === 'human.intervention').length,
      hasGenesis: allEvents.some(e => e.type === 'genesis'),
      chainLength: allEvents.length,
      lastEventTimestamp: latestEvent?.timestamp ?? null,
    };
  }
}
