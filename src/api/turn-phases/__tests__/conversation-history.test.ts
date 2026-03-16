import { describe, it, expect } from 'vitest';
import { assembleConversationHistory, type ConversationHistoryPhaseInput } from '../conversation-history';
import { MessageRole } from '../../../core/conversation/ConversationMessage';
import { GMIInteractionType } from '../../../cognitive_substrate/IGMI';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: { id?: string; role: MessageRole; content: string; timestamp?: number }) {
  return {
    id: overrides.id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: overrides.role,
    content: overrides.content,
    timestamp: overrides.timestamp ?? Date.now(),
  };
}

function makeConversationContext(messages: ReturnType<typeof makeMessage>[]) {
  return {
    getAllMessages: () => [...messages],
    getHistory: (_limit: any, excludeRoles?: MessageRole[]) => {
      const excludeSet = new Set(excludeRoles ?? []);
      return messages.filter((m) => !excludeSet.has(m.role));
    },
  } as any;
}

function makeBaseInput(overrides?: Partial<ConversationHistoryPhaseInput>): ConversationHistoryPhaseInput {
  return {
    conversationContext: undefined,
    gmiInput: {
      interactionId: 'int-1',
      userId: 'u1',
      type: GMIInteractionType.TEXT,
      content: 'Hello',
    },
    rollingSummaryEnabled: false,
    rollingSummaryResult: null,
    rollingSummaryText: '',
    rollingSummaryConfigForTurn: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assembleConversationHistory', () => {
  it('returns null when no conversationContext', () => {
    const result = assembleConversationHistory(makeBaseInput());
    expect(result).toBeNull();
  });

  it('returns filtered messages excluding ERROR and THOUGHT roles', () => {
    const messages = [
      makeMessage({ role: MessageRole.USER, content: 'hi' }),
      makeMessage({ role: MessageRole.ASSISTANT, content: 'hello' }),
      makeMessage({ role: MessageRole.ERROR, content: 'err' }),
      makeMessage({ role: MessageRole.THOUGHT, content: 'thinking...' }),
      makeMessage({ role: MessageRole.USER, content: 'question' }),
    ];
    const ctx = makeConversationContext(messages);
    const result = assembleConversationHistory(
      makeBaseInput({ conversationContext: ctx }),
    );
    expect(result).not.toBeNull();
    // ERROR and THOUGHT filtered out
    expect(result!.length).toBe(3);
    expect(result!.every((m: any) => m.role !== MessageRole.ERROR && m.role !== MessageRole.THOUGHT)).toBe(true);
  });

  it('deduplicates the current user message if it matches the last message in history', () => {
    const messages = [
      makeMessage({ role: MessageRole.ASSISTANT, content: 'previous response' }),
      makeMessage({ role: MessageRole.USER, content: 'Hello' }),
    ];
    const ctx = makeConversationContext(messages);
    const result = assembleConversationHistory(
      makeBaseInput({
        conversationContext: ctx,
        gmiInput: {
          interactionId: 'int-1',
          userId: 'u1',
          type: GMIInteractionType.TEXT,
          content: 'Hello',
        },
      }),
    );
    // Last user message duplicated the current inbound — should be removed
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0].role).toBe(MessageRole.ASSISTANT);
  });

  it('does not deduplicate when last message does not match inbound', () => {
    const messages = [
      makeMessage({ role: MessageRole.USER, content: 'First question' }),
      makeMessage({ role: MessageRole.USER, content: 'Different question' }),
    ];
    const ctx = makeConversationContext(messages);
    const result = assembleConversationHistory(
      makeBaseInput({
        conversationContext: ctx,
        gmiInput: {
          interactionId: 'int-1',
          userId: 'u1',
          type: GMIInteractionType.TEXT,
          content: 'First question',
        },
      }),
    );
    expect(result!.length).toBe(2);
  });

  it('does not deduplicate when last message is not from USER role', () => {
    const messages = [
      makeMessage({ role: MessageRole.USER, content: 'Hello' }),
      makeMessage({ role: MessageRole.ASSISTANT, content: 'Hello' }),
    ];
    const ctx = makeConversationContext(messages);
    const result = assembleConversationHistory(
      makeBaseInput({
        conversationContext: ctx,
        gmiInput: {
          interactionId: 'int-1',
          userId: 'u1',
          type: GMIInteractionType.TEXT,
          content: 'Hello',
        },
      }),
    );
    expect(result!.length).toBe(2);
  });

  describe('rolling summary trimming', () => {
    it('keeps head messages + unsummarized tail when rolling summary is active', () => {
      const now = Date.now();
      const summaryTimestamp = now - 5000;
      const messages = [
        makeMessage({ id: 'h1', role: MessageRole.SYSTEM, content: 'system', timestamp: now - 10000 }),
        makeMessage({ id: 'h2', role: MessageRole.USER, content: 'old msg', timestamp: now - 9000 }),
        makeMessage({ id: 'old1', role: MessageRole.ASSISTANT, content: 'summarized', timestamp: now - 8000 }),
        makeMessage({ id: 'old2', role: MessageRole.USER, content: 'also summarized', timestamp: now - 7000 }),
        makeMessage({ id: 'new1', role: MessageRole.ASSISTANT, content: 'after summary', timestamp: now - 3000 }),
        makeMessage({ id: 'new2', role: MessageRole.USER, content: 'recent', timestamp: now - 1000 }),
      ];
      const ctx = makeConversationContext(messages);

      const result = assembleConversationHistory(
        makeBaseInput({
          conversationContext: ctx,
          rollingSummaryEnabled: true,
          rollingSummaryResult: {
            enabled: true,
            didCompact: true,
            summaryText: 'A summary of old messages.',
            summaryJson: null,
            summaryUptoTimestamp: summaryTimestamp,
            summaryUpdatedAt: now,
          },
          rollingSummaryText: 'A summary of old messages.',
          rollingSummaryConfigForTurn: {
            enabled: true,
            modelId: 'gpt-4o-mini',
            cooldownMs: 60000,
            headMessagesToKeep: 2,
            tailMessagesToKeep: 12,
            minMessagesToSummarize: 4,
            maxMessagesToSummarizePerPass: 48,
            maxOutputTokens: 900,
          },
        }),
      );

      expect(result).not.toBeNull();
      const ids = result!.map((m: any) => m.id);
      // Head: h1, h2 (headMessagesToKeep=2)
      // After summary (timestamp > summaryTimestamp): new1, new2
      expect(ids).toContain('h1');
      expect(ids).toContain('h2');
      expect(ids).toContain('new1');
      expect(ids).toContain('new2');
      // old1, old2 are before summaryTimestamp, should not be in the trimmed set
      // (they are not in head and not after summary)
      expect(ids).not.toContain('old1');
      expect(ids).not.toContain('old2');
    });

    it('deduplicates across head and tail', () => {
      const now = Date.now();
      const messages = [
        makeMessage({ id: 'overlap', role: MessageRole.SYSTEM, content: 'sys', timestamp: now - 1000 }),
        makeMessage({ id: 'after1', role: MessageRole.USER, content: 'q', timestamp: now }),
      ];
      const ctx = makeConversationContext(messages);

      const result = assembleConversationHistory(
        makeBaseInput({
          conversationContext: ctx,
          rollingSummaryEnabled: true,
          rollingSummaryResult: {
            enabled: true,
            didCompact: true,
            summaryText: 'Summary',
            summaryJson: null,
            summaryUptoTimestamp: now - 2000, // both messages are after
            summaryUpdatedAt: now,
          },
          rollingSummaryText: 'Summary',
          rollingSummaryConfigForTurn: {
            enabled: true,
            modelId: 'gpt-4o-mini',
            cooldownMs: 60000,
            headMessagesToKeep: 5, // large enough to include all messages
            tailMessagesToKeep: 12,
            minMessagesToSummarize: 4,
            maxMessagesToSummarizePerPass: 48,
            maxOutputTokens: 900,
          },
        }),
      );

      // Both messages are in head AND in afterSummary, but dedup ensures only 2 entries
      const ids = result!.map((m: any) => m.id);
      expect(ids.length).toBe(2);
      expect(new Set(ids).size).toBe(2); // no duplicates
    });
  });
});
