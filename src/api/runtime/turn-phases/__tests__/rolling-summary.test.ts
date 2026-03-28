import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the RollingSummaryCompactor module
vi.mock('../../../core/conversation/RollingSummaryCompactor', () => ({
  maybeCompactConversationMessages: vi.fn(),
}));

import { executeRollingSummaryPhase, type RollingSummaryPhaseInput } from '../rolling-summary';
import { maybeCompactConversationMessages } from '../../../../core/conversation/RollingSummaryCompactor';
import type { RollingSummaryCompactionConfig, RollingSummaryCompactionResult } from '../../../../core/conversation/RollingSummaryCompactor';
import type { RollingSummaryCompactionProfilesConfig } from '../../types/OrchestratorConfig';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockConversationContext() {
  return {
    getAllMessages: vi.fn().mockReturnValue([]),
    getAllMetadata: vi.fn().mockReturnValue({}),
    setMetadata: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
  } as any;
}

function createMockModelProviderManager() {
  const mockProvider = {
    providerId: 'mock-provider',
    generateCompletion: vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Compacted summary text.' } }],
    }),
  };
  return {
    getProviderForModel: vi.fn().mockReturnValue({ providerId: 'mock-provider' }),
    getDefaultProvider: vi.fn().mockReturnValue({ providerId: 'mock-provider' }),
    getProvider: vi.fn().mockReturnValue(mockProvider),
  } as any;
}

const baseCompactionConfig: RollingSummaryCompactionConfig = {
  enabled: true,
  modelId: 'gpt-4o-mini',
  cooldownMs: 60000,
  headMessagesToKeep: 2,
  tailMessagesToKeep: 12,
  minMessagesToSummarize: 4,
  maxMessagesToSummarizePerPass: 48,
  maxOutputTokens: 900,
  temperature: 0.1,
};

function makeBaseInput(overrides?: Partial<RollingSummaryPhaseInput>): RollingSummaryPhaseInput {
  return {
    conversationContext: createMockConversationContext(),
    modeForRouting: 'chat',
    streamId: 'stream-1',
    rollingSummaryCompactionConfig: baseCompactionConfig,
    rollingSummaryCompactionProfilesConfig: null,
    rollingSummarySystemPrompt: 'You are a compactor.',
    rollingSummaryStateKey: 'rollingSummary',
    modelProviderManager: createMockModelProviderManager(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeRollingSummaryPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns disabled result when no compaction config is provided', async () => {
    const result = await executeRollingSummaryPhase(
      makeBaseInput({ rollingSummaryCompactionConfig: null }),
    );
    expect(result.enabled).toBe(false);
    expect(result.summaryText).toBe('');
    expect(result.result).toBeNull();
    expect(result.profileId).toBeNull();
    expect(maybeCompactConversationMessages).not.toHaveBeenCalled();
  });

  it('returns disabled result when conversationContext is undefined', async () => {
    const result = await executeRollingSummaryPhase(
      makeBaseInput({ conversationContext: undefined }),
    );
    expect(result.result).toBeNull();
    expect(maybeCompactConversationMessages).not.toHaveBeenCalled();
  });

  it('returns enabled result with summary text when compaction succeeds', async () => {
    const compactionResult: RollingSummaryCompactionResult & { updatedSessionMetadata?: Record<string, any> } = {
      enabled: true,
      didCompact: true,
      summaryText: 'This is the rolling summary.',
      summaryJson: null,
      summaryUptoTimestamp: Date.now() - 5000,
      summaryUpdatedAt: Date.now(),
    };

    vi.mocked(maybeCompactConversationMessages).mockResolvedValue(compactionResult);

    const result = await executeRollingSummaryPhase(makeBaseInput());

    expect(result.enabled).toBe(true);
    expect(result.summaryText).toBe('This is the rolling summary.');
    expect(result.result).toBe(compactionResult);
    expect(result.configForTurn).toBe(baseCompactionConfig);
    expect(maybeCompactConversationMessages).toHaveBeenCalledTimes(1);
  });

  it('persists updated session metadata via setMetadata', async () => {
    const ctx = createMockConversationContext();
    const compactionResult = {
      enabled: true,
      didCompact: true,
      summaryText: 'Summary',
      summaryJson: null,
      summaryUptoTimestamp: Date.now(),
      summaryUpdatedAt: Date.now(),
      updatedSessionMetadata: {
        rollingSummary: { text: 'Summary', updatedAt: Date.now() },
      },
    };
    vi.mocked(maybeCompactConversationMessages).mockResolvedValue(compactionResult);

    await executeRollingSummaryPhase(makeBaseInput({ conversationContext: ctx }));

    expect(ctx.setMetadata).toHaveBeenCalledWith(
      'rollingSummary',
      compactionResult.updatedSessionMetadata.rollingSummary,
    );
  });

  // --- Profile selection ---

  describe('profile selection', () => {
    const profilesConfig: RollingSummaryCompactionProfilesConfig = {
      defaultProfileId: 'default-profile',
      defaultProfileByMode: {
        chat: 'chat-profile',
        code: 'code-profile',
      },
      profiles: {
        'default-profile': {
          config: { ...baseCompactionConfig, maxOutputTokens: 500 },
          systemPrompt: 'Default system prompt.',
        },
        'chat-profile': {
          config: { ...baseCompactionConfig, maxOutputTokens: 1200 },
          systemPrompt: 'Chat-specific system prompt.',
        },
        'code-profile': {
          config: { ...baseCompactionConfig, maxOutputTokens: 800 },
        },
      },
    };

    it('selects profile by mode match', async () => {
      vi.mocked(maybeCompactConversationMessages).mockResolvedValue({
        enabled: true,
        didCompact: false,
        summaryText: null,
        summaryJson: null,
        summaryUptoTimestamp: null,
        summaryUpdatedAt: null,
      });

      const result = await executeRollingSummaryPhase(
        makeBaseInput({
          modeForRouting: 'chat',
          rollingSummaryCompactionProfilesConfig: profilesConfig,
        }),
      );

      expect(result.profileId).toBe('chat-profile');
      expect(result.configForTurn!.maxOutputTokens).toBe(1200);
    });

    it('falls back to defaultProfileId when mode does not match', async () => {
      vi.mocked(maybeCompactConversationMessages).mockResolvedValue({
        enabled: true,
        didCompact: false,
        summaryText: null,
        summaryJson: null,
        summaryUptoTimestamp: null,
        summaryUpdatedAt: null,
      });

      const result = await executeRollingSummaryPhase(
        makeBaseInput({
          modeForRouting: 'unknown-mode',
          rollingSummaryCompactionProfilesConfig: profilesConfig,
        }),
      );

      expect(result.profileId).toBe('default-profile');
      expect(result.configForTurn!.maxOutputTokens).toBe(500);
    });

    it('uses profile systemPrompt if provided', async () => {
      vi.mocked(maybeCompactConversationMessages).mockResolvedValue({
        enabled: true,
        didCompact: false,
        summaryText: null,
        summaryJson: null,
        summaryUptoTimestamp: null,
        summaryUpdatedAt: null,
      });

      await executeRollingSummaryPhase(
        makeBaseInput({
          modeForRouting: 'chat',
          rollingSummaryCompactionProfilesConfig: profilesConfig,
        }),
      );

      // The llmCaller is created internally but we can verify the call was made
      expect(maybeCompactConversationMessages).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(maybeCompactConversationMessages).mock.calls[0][0];
      expect(callArgs.systemPrompt).toBe('Chat-specific system prompt.');
    });
  });

  // --- Error handling ---

  describe('error handling', () => {
    it('handles compaction errors gracefully and returns disabled result', async () => {
      vi.mocked(maybeCompactConversationMessages).mockRejectedValue(
        new Error('LLM provider unavailable'),
      );
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await executeRollingSummaryPhase(makeBaseInput());

      expect(result.enabled).toBe(true); // config is enabled
      expect(result.summaryText).toBe(''); // but no summary produced
      expect(result.result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('returns empty summaryText when compaction result summaryText is empty', async () => {
      vi.mocked(maybeCompactConversationMessages).mockResolvedValue({
        enabled: true,
        didCompact: false,
        summaryText: '',
        summaryJson: null,
        summaryUptoTimestamp: null,
        summaryUpdatedAt: null,
      });

      const result = await executeRollingSummaryPhase(makeBaseInput());
      expect(result.summaryText).toBe('');
    });

    it('trims whitespace from summaryText', async () => {
      vi.mocked(maybeCompactConversationMessages).mockResolvedValue({
        enabled: true,
        didCompact: true,
        summaryText: '  Summary with whitespace.  ',
        summaryJson: null,
        summaryUptoTimestamp: Date.now(),
        summaryUpdatedAt: Date.now(),
      });

      const result = await executeRollingSummaryPhase(makeBaseInput());
      expect(result.summaryText).toBe('Summary with whitespace.');
    });

    it('returns summaryText as empty when config.enabled is false', async () => {
      const disabledConfig = { ...baseCompactionConfig, enabled: false };
      vi.mocked(maybeCompactConversationMessages).mockResolvedValue({
        enabled: false,
        didCompact: false,
        summaryText: 'stale summary',
        summaryJson: null,
        summaryUptoTimestamp: null,
        summaryUpdatedAt: null,
      });

      const result = await executeRollingSummaryPhase(
        makeBaseInput({ rollingSummaryCompactionConfig: disabledConfig }),
      );
      // enabled = Boolean(configForTurn?.enabled) = false
      // So summaryText should be '' because enabled is false
      expect(result.enabled).toBe(false);
      expect(result.summaryText).toBe('');
    });
  });
});
