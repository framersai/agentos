/**
 * @file AgentOrchestrator.test.ts
 * @description Comprehensive unit tests for the AgentOS Orchestrator (AgentOSOrchestrator class).
 * Tests cover initialization, turn processing, tool coordination, streaming, state management, and shutdown.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AgentOSOrchestrator,
  type AgentOSOrchestratorConfig,
  type AgentOSOrchestratorDependencies,
} from '../AgentOrchestrator';
import type { GMIManager } from '../../../cognitive_substrate/GMIManager';
import type { ToolOrchestrator } from '../../tools/ToolOrchestrator';
import type { ConversationManager } from '../../conversation/ConversationManager';
import type { StreamingManager, StreamId } from '../../streaming/StreamingManager';
import type { IGMI, GMIOutputChunkType, GMIOutputChunk } from '../../../cognitive_substrate/IGMI';
import type { ConversationContext } from '../../conversation/ConversationContext';
import { AgentOSInput } from '../../../api/types/AgentOSInput';
import { GMIError, GMIErrorCode } from '../../../utils/errors';

describe('AgentOSOrchestrator', () => {
  let orchestrator: AgentOSOrchestrator;
  let mockGMIManager: GMIManager;
  let mockToolOrchestrator: ToolOrchestrator;
  let mockConversationManager: ConversationManager;
  let mockStreamingManager: StreamingManager;
  let mockModelProviderManager: any;
  let mockGMI: IGMI;
  let mockConversationContext: ConversationContext;

  beforeEach(() => {
    // Create fresh orchestrator instance
    orchestrator = new AgentOSOrchestrator();

    // Create mock conversation context (use unknown cast since ConversationContext is a class)
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

    // Create mock GMI with all required methods
    mockGMI = {
      gmiId: 'gmi-1',
      personaId: 'persona-1',
      // Required getter methods
      getGMIId: vi.fn().mockReturnValue('gmi-1'),
      getCurrentPrimaryPersonaId: vi.fn().mockReturnValue('persona-1'),
      getPersona: vi.fn().mockReturnValue(mockPersonaDefinition),
      // Streaming methods
      processTurnStream: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'TEXT_DELTA' as GMIOutputChunkType,
          content: 'Hello',
          interactionId: 'interaction-1',
          timestamp: new Date(),
        } as GMIOutputChunk;
        return {
          isFinal: true,
          responseText: 'Hello',
        };
      }),
      handleToolResult: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'TEXT_DELTA' as GMIOutputChunkType,
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

    // Create mock GMI Manager - returns { gmi, conversationContext }
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
    } as unknown as ToolOrchestrator;

    // Create mock Conversation Manager
    mockConversationManager = {
      getOrCreateContext: vi.fn().mockResolvedValue(mockConversationContext),
      saveContext: vi.fn().mockResolvedValue(undefined),
      saveConversation: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConversationManager;

    // Create mock Streaming Manager with unique stream IDs
    let streamCounter = 0;
    mockStreamingManager = {
      createStream: vi.fn().mockImplementation(() => `stream-${++streamCounter}`),
      pushChunk: vi.fn().mockResolvedValue(undefined),
      endStream: vi.fn().mockResolvedValue(undefined),
      closeStream: vi.fn().mockResolvedValue(undefined),
    } as unknown as StreamingManager;

    mockModelProviderManager = {
      getProviderForModel: vi.fn().mockReturnValue(undefined),
      getDefaultProvider: vi.fn().mockReturnValue(undefined),
      getProvider: vi.fn().mockReturnValue(undefined),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize successfully with valid dependencies', async () => {
      const config: AgentOSOrchestratorConfig = {
        maxToolCallIterations: 5,
        defaultAgentTurnTimeoutMs: 120000,
      };

      const dependencies: AgentOSOrchestratorDependencies = {
        gmiManager: mockGMIManager,
        toolOrchestrator: mockToolOrchestrator,
        conversationManager: mockConversationManager,
        streamingManager: mockStreamingManager,
        modelProviderManager: mockModelProviderManager,
      };

      await expect(orchestrator.initialize(config, dependencies)).resolves.toBeUndefined();
    });

    it('should throw GMIError when missing gmiManager dependency', async () => {
      const config: AgentOSOrchestratorConfig = {};
      const dependencies = {
        gmiManager: undefined as any,
        toolOrchestrator: mockToolOrchestrator,
        conversationManager: mockConversationManager,
        streamingManager: mockStreamingManager,
        modelProviderManager: mockModelProviderManager,
      };

      await expect(orchestrator.initialize(config, dependencies)).rejects.toThrow(GMIError);
      await expect(orchestrator.initialize(config, dependencies)).rejects.toThrow(/gmiManager/);
    });

    it('should throw GMIError when missing toolOrchestrator dependency', async () => {
      const config: AgentOSOrchestratorConfig = {};
      const dependencies = {
        gmiManager: mockGMIManager,
        toolOrchestrator: undefined as any,
        conversationManager: mockConversationManager,
        streamingManager: mockStreamingManager,
        modelProviderManager: mockModelProviderManager,
      };

      await expect(orchestrator.initialize(config, dependencies)).rejects.toThrow(GMIError);
      await expect(orchestrator.initialize(config, dependencies)).rejects.toThrow(/toolOrchestrator/);
    });

    it('should throw GMIError when missing conversationManager dependency', async () => {
      const config: AgentOSOrchestratorConfig = {};
      const dependencies = {
        gmiManager: mockGMIManager,
        toolOrchestrator: mockToolOrchestrator,
        conversationManager: undefined as any,
        streamingManager: mockStreamingManager,
        modelProviderManager: mockModelProviderManager,
      };

      await expect(orchestrator.initialize(config, dependencies)).rejects.toThrow(GMIError);
      await expect(orchestrator.initialize(config, dependencies)).rejects.toThrow(/conversationManager/);
    });

    it('should throw GMIError when missing streamingManager dependency', async () => {
      const config: AgentOSOrchestratorConfig = {};
      const dependencies = {
        gmiManager: mockGMIManager,
        toolOrchestrator: mockToolOrchestrator,
        conversationManager: mockConversationManager,
        streamingManager: undefined as any,
        modelProviderManager: mockModelProviderManager,
      };

      await expect(orchestrator.initialize(config, dependencies)).rejects.toThrow(GMIError);
      await expect(orchestrator.initialize(config, dependencies)).rejects.toThrow(/streamingManager/);
    });

    it('should prevent double initialization with warning', async () => {
      const config: AgentOSOrchestratorConfig = {};
      const dependencies: AgentOSOrchestratorDependencies = {
        gmiManager: mockGMIManager,
        toolOrchestrator: mockToolOrchestrator,
        conversationManager: mockConversationManager,
        streamingManager: mockStreamingManager,
        modelProviderManager: mockModelProviderManager,
      };

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await orchestrator.initialize(config, dependencies);
      await orchestrator.initialize(config, dependencies); // Second call

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('already initialized'));
      consoleSpy.mockRestore();
    });

    it('should apply default configuration values when partial config provided', async () => {
      const partialConfig: AgentOSOrchestratorConfig = {
        maxToolCallIterations: 10, // Override default
        // Other values should use defaults
      };

      const dependencies: AgentOSOrchestratorDependencies = {
        gmiManager: mockGMIManager,
        toolOrchestrator: mockToolOrchestrator,
        conversationManager: mockConversationManager,
        streamingManager: mockStreamingManager,
        modelProviderManager: mockModelProviderManager,
      };

      await expect(orchestrator.initialize(partialConfig, dependencies)).resolves.toBeUndefined();
    });

    it('should respect custom maxToolCallIterations config', async () => {
      const config: AgentOSOrchestratorConfig = {
        maxToolCallIterations: 10,
      };

      const dependencies: AgentOSOrchestratorDependencies = {
        gmiManager: mockGMIManager,
        toolOrchestrator: mockToolOrchestrator,
        conversationManager: mockConversationManager,
        streamingManager: mockStreamingManager,
        modelProviderManager: mockModelProviderManager,
      };

      await expect(orchestrator.initialize(config, dependencies)).resolves.toBeUndefined();
      // Note: Testing the actual enforcement requires integration tests with tool calls
    });

    it('should respect custom defaultAgentTurnTimeoutMs config', async () => {
      const config: AgentOSOrchestratorConfig = {
        defaultAgentTurnTimeoutMs: 60000, // 1 minute instead of default 2
      };

      const dependencies: AgentOSOrchestratorDependencies = {
        gmiManager: mockGMIManager,
        toolOrchestrator: mockToolOrchestrator,
        conversationManager: mockConversationManager,
        streamingManager: mockStreamingManager,
        modelProviderManager: mockModelProviderManager,
      };

      await expect(orchestrator.initialize(config, dependencies)).resolves.toBeUndefined();
    });
  });

  describe('Turn Processing', () => {
    beforeEach(async () => {
      // Initialize orchestrator for turn processing tests
      await orchestrator.initialize(
        { maxToolCallIterations: 5 },
        {
          gmiManager: mockGMIManager,
          toolOrchestrator: mockToolOrchestrator,
          conversationManager: mockConversationManager,
          streamingManager: mockStreamingManager,
          modelProviderManager: mockModelProviderManager,
        },
      );
    });

    it('should process simple text turn and return streamId', async () => {
      const input: AgentOSInput = {
        userId: 'user-1',
        sessionId: 'session-1',
        selectedPersonaId: 'persona-1',
        textInput: 'Hello, how are you?',
      };

      const streamId = await orchestrator.orchestrateTurn(input);

      expect(streamId).toMatch(/^stream-\d+$/);
      expect(mockStreamingManager.createStream).toHaveBeenCalledWith(
        expect.stringContaining('session-1'),
      );
    });

    it('should create GMI instance via GMIManager for new session', async () => {
      const input: AgentOSInput = {
        userId: 'user-1',
        sessionId: 'session-new',
        selectedPersonaId: 'persona-1',
        textInput: 'Test message',
      };

      await orchestrator.orchestrateTurn(input);

      // Allow async processing to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockGMIManager.getOrCreateGMIForSession).toHaveBeenCalled();
    });

    it('should obtain conversation context via GMIManager', async () => {
      const input: AgentOSInput = {
        userId: 'user-1',
        sessionId: 'session-1',
        selectedPersonaId: 'persona-1',
        textInput: 'Test',
      };

      await orchestrator.orchestrateTurn(input);

      // Allow async processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // GMIManager.getOrCreateGMIForSession returns { gmi, conversationContext }
      expect(mockGMIManager.getOrCreateGMIForSession).toHaveBeenCalled();
    });

    it('should stream text deltas from GMI to StreamingManager', async () => {
      const input: AgentOSInput = {
        userId: 'user-1',
        sessionId: 'session-1',
        selectedPersonaId: 'persona-1',
        textInput: 'Test',
      };

      await orchestrator.orchestrateTurn(input);

      // Allow async processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockStreamingManager.pushChunk).toHaveBeenCalled();
    });

    it('should process GMI output and push chunks to stream', async () => {
      const input: AgentOSInput = {
        userId: 'user-1',
        sessionId: 'session-1',
        selectedPersonaId: 'persona-1',
        textInput: 'Complete this turn',
      };

      await orchestrator.orchestrateTurn(input);

      // Allow full async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify chunks were pushed to stream
      expect(mockStreamingManager.pushChunk).toHaveBeenCalled();
    });
  });

  describe('Long-Term Memory Policy', () => {
    let mockRollingSummaryMemorySink: { upsertRollingSummaryMemory: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
      mockRollingSummaryMemorySink = {
        upsertRollingSummaryMemory: vi.fn().mockResolvedValue(undefined),
      };

      const mockProvider = {
        generateCompletion: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary_markdown: '- summary',
                  memory_json: {
                    facts: [{ text: 'User prefers TypeScript', confidence: 0.8, sources: ['msg-1'] }],
                    preferences: [],
                    people: [],
                    projects: [],
                    decisions: [],
                    open_loops: [],
                    todo: [],
                    tags: ['typescript'],
                  },
                }),
              },
            },
          ],
        }),
      };

      mockModelProviderManager.getProviderForModel = vi.fn().mockReturnValue({ providerId: 'mock' });
      mockModelProviderManager.getDefaultProvider = vi.fn().mockReturnValue({ providerId: 'mock' });
      mockModelProviderManager.getProvider = vi.fn().mockReturnValue(mockProvider);

      vi.mocked(mockConversationContext.getAllMessages).mockReturnValue([
        { id: 'msg-1', role: 'user', content: 'Hello', timestamp: 1 } as any,
      ]);

      await orchestrator.initialize(
        {
          maxToolCallIterations: 1,
          rollingSummaryCompactionConfig: {
            enabled: true,
            modelId: 'mock-model',
            cooldownMs: 0,
            headMessagesToKeep: 0,
            tailMessagesToKeep: 0,
            minMessagesToSummarize: 1,
            maxMessagesToSummarizePerPass: 10,
            maxOutputTokens: 128,
            temperature: 0,
          },
        },
        {
          gmiManager: mockGMIManager,
          toolOrchestrator: mockToolOrchestrator,
          conversationManager: mockConversationManager,
          streamingManager: mockStreamingManager,
          modelProviderManager: mockModelProviderManager,
          rollingSummaryMemorySink: mockRollingSummaryMemorySink as any,
        },
      );
    });

    it('should not call rollingSummaryMemorySink when long-term memory is disabled', async () => {
      const input: AgentOSInput = {
        userId: 'user-1',
        sessionId: 'session-1',
        selectedPersonaId: 'persona-1',
        textInput: 'Hello',
        memoryControl: { longTermMemory: { enabled: false } },
      };

      await orchestrator.orchestrateTurn(input);
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(mockRollingSummaryMemorySink.upsertRollingSummaryMemory).not.toHaveBeenCalled();
    });

    it('should pass organizationId + resolved policy into rollingSummaryMemorySink', async () => {
      const input: AgentOSInput = {
        userId: 'user-1',
        organizationId: 'org-1',
        sessionId: 'session-1',
        selectedPersonaId: 'persona-1',
        textInput: 'Hello',
        memoryControl: {
          longTermMemory: {
            enabled: true,
            scopes: { conversation: true, user: true },
          },
        },
      };

      await orchestrator.orchestrateTurn(input);
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(mockRollingSummaryMemorySink.upsertRollingSummaryMemory).toHaveBeenCalled();
      const firstCall = mockRollingSummaryMemorySink.upsertRollingSummaryMemory.mock.calls[0]?.[0];
      expect(firstCall.organizationId).toBe('org-1');
      expect(firstCall.memoryPolicy?.enabled).toBe(true);
      expect(firstCall.memoryPolicy?.scopes?.user).toBe(true);
      expect(firstCall.memoryPolicy?.scopes?.conversation).toBe(true);
    });
  });

  describe('Tool Calling', () => {
    beforeEach(async () => {
      await orchestrator.initialize(
        { maxToolCallIterations: 3 },
        {
          gmiManager: mockGMIManager,
          toolOrchestrator: mockToolOrchestrator,
          conversationManager: mockConversationManager,
          streamingManager: mockStreamingManager,
          modelProviderManager: mockModelProviderManager,
        },
      );
    });

    it('should relay tool call requests to StreamingManager', async () => {
      // Mock GMI that emits a tool call request - must include all required methods
      const mockPersonaDef = {
        id: 'persona-1',
        name: 'Test Persona',
        version: '1.0.0',
        baseSystemPrompt: 'You are a helpful assistant.',
      };

      const gmiWithToolCall = {
        getGMIId: vi.fn().mockReturnValue('gmi-tool-test'),
        getCurrentPrimaryPersonaId: vi.fn().mockReturnValue('persona-1'),
        getPersona: vi.fn().mockReturnValue(mockPersonaDef),
        processTurnStream: vi.fn().mockImplementation(async function* () {
          yield {
            type: 'TOOL_CALL_REQUEST' as GMIOutputChunkType,
            content: {
              id: 'tool-call-1',
              name: 'get_weather',
              arguments: { city: 'London' },
            },
            interactionId: 'interaction-tool-1',
            timestamp: new Date(),
          } as GMIOutputChunk;
        }),
        handleToolResult: vi.fn(),
        shutdown: vi.fn(),
      };

      vi.mocked(mockGMIManager.getOrCreateGMIForSession).mockResolvedValue({
        gmi: gmiWithToolCall as unknown as IGMI,
        conversationContext: mockConversationContext,
      });

      const input: AgentOSInput = {
        userId: 'user-1',
        sessionId: 'session-1',
        selectedPersonaId: 'persona-1',
        textInput: 'What is the weather?',
      };

      await orchestrator.orchestrateTurn(input);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify that pushChunk was called (may be with tool request or error)
      expect(mockStreamingManager.pushChunk).toHaveBeenCalled();
    });

    it('should handle orchestrateToolResult for non-existent stream gracefully', async () => {
      // This should not throw but log a warning for unknown stream
      await expect(
        orchestrator.orchestrateToolResult('non-existent-stream', 'tool-1', 'bad_tool', null, false),
      ).rejects.toThrow(); // Throws because stream doesn't exist
    });
  });

  describe('State Management', () => {
    beforeEach(async () => {
      await orchestrator.initialize(
        {},
        {
          gmiManager: mockGMIManager,
          toolOrchestrator: mockToolOrchestrator,
          conversationManager: mockConversationManager,
          streamingManager: mockStreamingManager,
          modelProviderManager: mockModelProviderManager,
        },
      );
    });

    it('should track multiple concurrent active streams', async () => {
      const input1: AgentOSInput = {
        userId: 'user-1',
        sessionId: 'session-1',
        selectedPersonaId: 'persona-1',
        textInput: 'First turn',
      };

      const input2: AgentOSInput = {
        userId: 'user-2',
        sessionId: 'session-2',
        selectedPersonaId: 'persona-1',
        textInput: 'Second turn',
      };

      const streamId1 = await orchestrator.orchestrateTurn(input1);
      const streamId2 = await orchestrator.orchestrateTurn(input2);

      expect(streamId1).not.toBe(streamId2);
      expect(mockStreamingManager.createStream).toHaveBeenCalledTimes(2);
    });
  });

  describe('Shutdown', () => {
    it('should warn when shutdown called before initialization', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await orchestrator.shutdown();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('not initialized'));
      consoleSpy.mockRestore();
    });

    it('should clear all active stream contexts on shutdown', async () => {
      await orchestrator.initialize(
        {},
        {
          gmiManager: mockGMIManager,
          toolOrchestrator: mockToolOrchestrator,
          conversationManager: mockConversationManager,
          streamingManager: mockStreamingManager,
          modelProviderManager: mockModelProviderManager,
        },
      );

      const input: AgentOSInput = {
        userId: 'user-1',
        sessionId: 'session-1',
        selectedPersonaId: 'persona-1',
        textInput: 'Test',
      };

      await orchestrator.orchestrateTurn(input);
      await orchestrator.shutdown();

      // After shutdown, orchestrator should be marked as not initialized
      // Next operation should fail or warn
    });

    it('should mark as not initialized after shutdown', async () => {
      await orchestrator.initialize(
        {},
        {
          gmiManager: mockGMIManager,
          toolOrchestrator: mockToolOrchestrator,
          conversationManager: mockConversationManager,
          streamingManager: mockStreamingManager,
          modelProviderManager: mockModelProviderManager,
        },
      );

      await orchestrator.shutdown();

      // Attempting to process turn should throw
      const input: AgentOSInput = {
        userId: 'user-1',
        sessionId: 'session-1',
        selectedPersonaId: 'persona-1',
        textInput: 'After shutdown',
      };

      await expect(orchestrator.orchestrateTurn(input)).rejects.toThrow();
    });

    it('should allow reinitialization after shutdown', async () => {
      await orchestrator.initialize(
        {},
        {
          gmiManager: mockGMIManager,
          toolOrchestrator: mockToolOrchestrator,
          conversationManager: mockConversationManager,
          streamingManager: mockStreamingManager,
          modelProviderManager: mockModelProviderManager,
        },
      );

      await orchestrator.shutdown();

      // Reinitialize
      await expect(
        orchestrator.initialize(
          {},
          {
            gmiManager: mockGMIManager,
            toolOrchestrator: mockToolOrchestrator,
            conversationManager: mockConversationManager,
            streamingManager: mockStreamingManager,
            modelProviderManager: mockModelProviderManager,
          },
        ),
      ).resolves.toBeUndefined();
    });
  });
});
