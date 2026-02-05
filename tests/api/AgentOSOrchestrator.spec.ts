/**
 * @file AgentOSOrchestrator.spec.ts (API layer)
 * @description Tests for model selection options propagation in the API AgentOSOrchestrator.
 * Specifically tests the fix for correctly passing `options` in GMITurnInput metadata.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentOSOrchestrator } from '../../src/api/AgentOSOrchestrator';
import type { AgentOSInput, ProcessingOptions } from '../../src/api/types/AgentOSInput';
import { AgentOSResponseChunkType } from '../../src/api/types/AgentOSResponse';
import { GMIOutputChunkType } from '../../src/cognitive_substrate/IGMI';
import type {
  GMITurnInput,
  IGMI,
  GMIOutputChunk,
} from '../../src/cognitive_substrate/IGMI';
import type { GMIManager } from '../../src/cognitive_substrate/GMIManager';
import type { IToolOrchestrator } from '../../src/core/tools/IToolOrchestrator';
import type { ConversationManager } from '../../src/core/conversation/ConversationManager';
import type { StreamingManager } from '../../src/core/streaming/StreamingManager';
import type { ConversationContext } from '../../src/core/conversation/ConversationContext';

describe('AgentOSOrchestrator (API layer)', () => {
  let orchestrator: AgentOSOrchestrator;
  let mockGMIManager: GMIManager;
  let mockToolOrchestrator: IToolOrchestrator;
  let mockConversationManager: ConversationManager;
  let mockStreamingManager: StreamingManager;
  let mockGMI: IGMI;
  let mockConversationContext: ConversationContext;
  let capturedGMIInput: GMITurnInput | null = null;

  beforeEach(() => {
    orchestrator = new AgentOSOrchestrator();
    capturedGMIInput = null;

    // Create mock conversation context
    mockConversationContext = {
      sessionId: 'conv-123',
      createdAt: Date.now(),
      userId: 'user-1',
      messages: [],
      config: {},
      sessionMetadata: {},
      getHistory: vi.fn().mockReturnValue([]),
      getAllMessages: vi.fn().mockReturnValue([]),
      addMessage: vi.fn(),
      addEntry: vi.fn(),
      getMetadata: vi.fn(),
      setMetadata: vi.fn(),
      getAllMetadata: vi.fn().mockReturnValue({}),
      clearHistory: vi.fn(),
      getTurnNumber: vi.fn().mockReturnValue(0),
      toJSON: vi.fn().mockReturnValue({}),
      currentLanguage: 'en-US',
    } as unknown as ConversationContext;

    // Create mock persona definition
    const mockPersonaDefinition = {
      id: 'persona-1',
      name: 'Test Persona',
      version: '1.0.0',
      baseSystemPrompt: 'You are a helpful assistant.',
    };

    // Create mock GMI that captures the input it receives
    mockGMI = {
      gmiId: 'gmi-1',
      personaId: 'persona-1',
      getGMIId: vi.fn().mockReturnValue('gmi-1'),
      getCurrentPrimaryPersonaId: vi.fn().mockReturnValue('persona-1'),
      getPersona: vi.fn().mockReturnValue(mockPersonaDefinition),
      processTurnStream: vi.fn().mockImplementation(async function* (input: GMITurnInput) {
        // Capture the input for assertions
        capturedGMIInput = input;
        yield {
          type: GMIOutputChunkType.TEXT_DELTA,
          content: 'Hello',
          interactionId: 'interaction-1',
          timestamp: new Date(),
        } as GMIOutputChunk;
        yield {
          type: GMIOutputChunkType.FINAL_RESPONSE_MARKER,
          content: { finalResponseText: 'Hello' },
          interactionId: 'interaction-1',
          timestamp: new Date(),
          isFinal: true,
        } as GMIOutputChunk;
        return {
          isFinal: true,
          responseText: 'Hello',
        };
      }),
      handleToolResult: vi.fn().mockImplementation(async function* () {
        yield {
          type: GMIOutputChunkType.TEXT_DELTA,
          content: 'Tool result processed',
          interactionId: 'interaction-1',
          timestamp: new Date(),
        } as GMIOutputChunk;
        return {
          isFinal: true,
          responseText: 'Tool result processed',
        };
      }),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as IGMI;

    // Create mock GMI Manager
    mockGMIManager = {
      getOrCreateGMIForSession: vi.fn().mockResolvedValue({
        gmi: mockGMI,
        conversationContext: mockConversationContext,
      }),
      deactivateGMIForSession: vi.fn().mockResolvedValue(true),
    } as unknown as GMIManager;

    // Create mock Tool Orchestrator
    mockToolOrchestrator = {
      orchestratorId: 'tool-orch-1',
      listAvailableTools: vi.fn().mockResolvedValue([]),
    } as unknown as IToolOrchestrator;

    // Create mock Conversation Manager
    mockConversationManager = {
      getOrCreateContext: vi.fn().mockResolvedValue(mockConversationContext),
      saveContext: vi.fn().mockResolvedValue(undefined),
      saveConversation: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConversationManager;

    // Create mock Streaming Manager
    let streamCounter = 0;
    mockStreamingManager = {
      createStream: vi.fn().mockImplementation(() => `stream-${++streamCounter}`),
      pushChunk: vi.fn().mockResolvedValue(undefined),
      endStream: vi.fn().mockResolvedValue(undefined),
      closeStream: vi.fn().mockResolvedValue(undefined),
    } as unknown as StreamingManager;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('model selection options propagation', () => {
    beforeEach(async () => {
      await orchestrator.initialize(
        {
          maxToolCallIterations: 5,
          defaultAgentTurnTimeoutMs: 120000,
        },
        {
          gmiManager: mockGMIManager,
          toolOrchestrator: mockToolOrchestrator,
          conversationManager: mockConversationManager,
          streamingManager: mockStreamingManager,
          modelProviderManager: {
            getProvider: vi.fn(),
            getProviderForModel: vi.fn(),
            getModelInfo: vi.fn(),
            listProviders: vi.fn().mockReturnValue([]),
            listModels: vi.fn().mockReturnValue([]),
          } as any,
        }
      );
    });

    it('passes options in GMITurnInput metadata (fix for PR #1)', async () => {
      const options: ProcessingOptions = {
        preferredModelId: 'gpt-4-turbo',
        preferredProviderId: 'openai',
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 2000,
      };

      const input: AgentOSInput = {
        userId: 'test-user',
        sessionId: 'test-session',
        textInput: 'Hello, world!',
        selectedPersonaId: 'persona-1',
        options,
      };

      // Process the input
      await orchestrator.orchestrateTurn(input);

      // Wait a bit for async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify the GMI received the input with correct metadata
      expect(capturedGMIInput).not.toBeNull();
      expect(capturedGMIInput?.metadata).toBeDefined();
      // The fix changed 'processingOptions' to 'options' in metadata
      expect(capturedGMIInput?.metadata?.options).toEqual(options);
    });

    it('includes modelSelectionOverrides from options', async () => {
      const options: ProcessingOptions = {
        preferredModelId: 'claude-3-opus',
        preferredProviderId: 'anthropic',
        temperature: 0.5,
        topP: 0.95,
        maxTokens: 4000,
      };

      const input: AgentOSInput = {
        userId: 'test-user',
        sessionId: 'test-session',
        textInput: 'Test query',
        options,
        selectedPersonaId: 'persona-1',
      };

      await orchestrator.orchestrateTurn(input);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const metadata = capturedGMIInput?.metadata;
      expect(metadata?.modelSelectionOverrides).toBeDefined();
      expect(metadata?.modelSelectionOverrides?.preferredModelId).toBe('claude-3-opus');
      expect(metadata?.modelSelectionOverrides?.preferredProviderId).toBe('anthropic');
      expect(metadata?.modelSelectionOverrides?.temperature).toBe(0.5);
      expect(metadata?.modelSelectionOverrides?.topP).toBe(0.95);
      expect(metadata?.modelSelectionOverrides?.maxTokens).toBe(4000);
    });

    it('handles undefined options gracefully', async () => {
      const input: AgentOSInput = {
        userId: 'test-user',
        sessionId: 'test-session',
        textInput: 'Query without options',
        selectedPersonaId: 'persona-1',
        // No options provided
      };

      await orchestrator.orchestrateTurn(input);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not throw, and options should be undefined in metadata
      expect(capturedGMIInput).not.toBeNull();
      expect(capturedGMIInput?.metadata?.options).toBeUndefined();
    });

    it('propagates userApiKeys in metadata', async () => {
      const input: AgentOSInput = {
        userId: 'test-user',
        sessionId: 'test-session',
        textInput: 'Test with API keys',
        selectedPersonaId: 'persona-1',
        userApiKeys: {
          openai: 'sk-test-key',
          anthropic: 'sk-ant-test',
        },
      };

      await orchestrator.orchestrateTurn(input);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedGMIInput?.metadata?.userApiKeys).toEqual({
        openai: 'sk-test-key',
        anthropic: 'sk-ant-test',
      });
    });

    it('propagates selectedPersonaId as explicitPersonaSwitchId', async () => {
      const input: AgentOSInput = {
        userId: 'test-user',
        sessionId: 'test-session',
        textInput: 'Test with persona',
        selectedPersonaId: 'custom-persona-123',
      };

      await orchestrator.orchestrateTurn(input);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedGMIInput?.metadata?.explicitPersonaSwitchId).toBe('custom-persona-123');
    });

    it('sets correct taskHint for text input', async () => {
      const input: AgentOSInput = {
        userId: 'test-user',
        sessionId: 'test-session',
        textInput: 'Text query',
        selectedPersonaId: 'persona-1',
      };

      await orchestrator.orchestrateTurn(input);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedGMIInput?.metadata?.taskHint).toBe('user_text_query');
    });

    it('sets correct taskHint for multimodal input', async () => {
      const input: AgentOSInput = {
        userId: 'test-user',
        sessionId: 'test-session-2',
        selectedPersonaId: 'persona-1',
        visionInputs: [{ type: 'image_url', url: 'https://example.com/image.png' }],
      };

      await orchestrator.orchestrateTurn(input);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedGMIInput?.metadata?.taskHint).toBe('user_multimodal_query');
    });

    it('includes gmiId in metadata', async () => {
      const input: AgentOSInput = {
        userId: 'test-user',
        sessionId: 'test-session',
        textInput: 'Test query',
        selectedPersonaId: 'persona-1',
      };

      await orchestrator.orchestrateTurn(input);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedGMIInput?.metadata?.gmiId).toBe('gmi-1');
    });

    it('uses the AsyncGenerator return value for finalResponseText (not the FINAL_RESPONSE_MARKER content)', async () => {
      // Simulate the real-world scenario: the marker content is a status string, while the
      // actual assistant response is returned via the generator return value.
      (mockGMI.processTurnStream as any).mockImplementation(async function* (_input: GMITurnInput) {
        yield {
          type: GMIOutputChunkType.TEXT_DELTA,
          content: 'Here are three tips: ',
          interactionId: 'interaction-1',
          timestamp: new Date(),
        } as GMIOutputChunk;
        yield {
          type: GMIOutputChunkType.FINAL_RESPONSE_MARKER,
          content: 'Turn processing sequence complete.',
          interactionId: 'interaction-1',
          timestamp: new Date(),
          isFinal: true,
        } as GMIOutputChunk;
        return {
          isFinal: true,
          responseText: 'Here are three tips: 1) Do X 2) Do Y 3) Do Z',
        };
      });

      const input: AgentOSInput = {
        userId: 'test-user',
        sessionId: 'test-session',
        textInput: 'Give me 3 tips',
        selectedPersonaId: 'persona-1',
      };

      await orchestrator.orchestrateTurn(input);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const pushedChunks = (mockStreamingManager.pushChunk as any).mock.calls.map((call: any[]) => call[1]);
      const finalChunk = pushedChunks.find((c: any) => c.type === AgentOSResponseChunkType.FINAL_RESPONSE);

      expect(finalChunk).toBeTruthy();
      expect(finalChunk.finalResponseText).toBe('Here are three tips: 1) Do X 2) Do Y 3) Do Z');
      expect(String(finalChunk.finalResponseText).toLowerCase()).not.toContain('turn processing sequence complete');
      expect(mockStreamingManager.closeStream).toHaveBeenCalled();
    });
  });
});
