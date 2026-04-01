/**
 * @file ConversationVerifier.ts
 * @description Convenience verifier for conversation-level provenance checks.
 * Filters events by conversation ID and verifies the sub-chain.
 *
 * @module AgentOS/Provenance/Verification
 */
import type { VerificationResult } from '../types.js';
import type { SignedEventLedger } from '../ledger/SignedEventLedger.js';
export interface ConversationVerificationResult extends VerificationResult {
    conversationId: string;
    messageCount: number;
    hasGenesis: boolean;
    hasHumanInterventions: boolean;
    humanInterventionCount: number;
    isFullyAutonomous: boolean;
}
export declare class ConversationVerifier {
    private readonly ledger;
    constructor(ledger: SignedEventLedger);
    /**
     * Verify the provenance chain for a specific conversation.
     *
     * @param conversationId - The conversation ID to verify.
     * @param publicKeyBase64 - Optional public key for signature verification.
     * @returns Detailed verification result including conversation-specific metadata.
     */
    verifyConversation(conversationId: string, publicKeyBase64?: string): Promise<ConversationVerificationResult>;
    /**
     * Verify a single post/message within a conversation.
     * Checks that the message event exists and its chain position is valid.
     *
     * @param messageId - The message ID to verify.
     * @param publicKeyBase64 - Optional public key for signature verification.
     */
    verifyMessage(messageId: string, publicKeyBase64?: string): Promise<VerificationResult & {
        messageId: string;
        found: boolean;
    }>;
    /**
     * Get a summary of provenance status for a conversation.
     * Lighter than full verification - just counts and metadata.
     */
    getProvenanceSummary(conversationId: string): Promise<{
        conversationId: string;
        totalEvents: number;
        messageEvents: number;
        revisionEvents: number;
        tombstoneEvents: number;
        humanInterventions: number;
        hasGenesis: boolean;
        chainLength: number;
        lastEventTimestamp: string | null;
    }>;
}
//# sourceMappingURL=ConversationVerifier.d.ts.map