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

    it('applies single-tenant default organization routing when organizationId is omitted', async () => {
      await orchestrator.shutdown();
      await orchestrator.initialize(
        {
          maxToolCallIterations: 5,
          defaultAgentTurnTimeoutMs: 120000,
          tenantRouting: {
            mode: 'single_tenant',
            defaultOrganizationId: 'org-default',
            strictOrganizationIsolation: true,
          },
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

      const input: AgentOSInput = {
        userId: 'test-user',
        sessionId: 'test-session',
        textInput: 'Hello',
        selectedPersonaId: 'persona-1',
      };

      await orchestrator.orchestrateTurn(input);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedGMIInput?.metadata?.organizationId).toBe('org-default');
      const pushedChunks = (mockStreamingManager.pushChunk as any).mock.calls.map((call: any[]) => call[1]);
      const tenantUpdateChunk = pushedChunks.find(
        (c: any) => c.type === AgentOSResponseChunkType.METADATA_UPDATE && c.updates?.tenantRouting,
      );
      expect(tenantUpdateChunk?.updates?.tenantRouting?.mode).toBe('single_tenant');
      expect(tenantUpdateChunk?.updates?.tenantRouting?.defaultOrganizationId).toBe('org-default');
    });

    it('uses aggressive long-term-memory recall defaults when retriever is present', async () => {
      const mockLongTermMemoryRetriever = {
        retrieveLongTermMemory: vi.fn().mockResolvedValue({
          contextText: '## User Memory\n- remembers preferences',
          diagnostics: { hits: 1 },
        }),
      };
      mockConversationContext.getAllMessages = vi.fn().mockReturnValue([
        { id: 'u-1', role: 'user', content: 'first', timestamp: 1 },
        { id: 'u-2', role: 'user', content: 'second', timestamp: 2 },
      ]);

      await orchestrator.shutdown();
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
          longTermMemoryRetriever: mockLongTermMemoryRetriever as any,
        }
      );

      const input: AgentOSInput = {
        userId: 'test-user',
        sessionId: 'test-session',
        textInput: 'recall what we decided',
        selectedPersonaId: 'persona-1',
        memoryControl: {
          longTermMemory: {
            scopes: { user: true },
          },
        },
      };

      await orchestrator.orchestrateTurn(input);
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(mockLongTermMemoryRetriever.retrieveLongTermMemory).toHaveBeenCalled();
      const retrieveInput = mockLongTermMemoryRetriever.retrieveLongTermMemory.mock.calls[0]?.[0];
      expect(retrieveInput.maxContextChars).toBe(4200);
      expect(retrieveInput.topKByScope).toEqual({ user: 8, persona: 8, organization: 8 });

      const pushedChunks = (mockStreamingManager.pushChunk as any).mock.calls.map((call: any[]) => call[1]);
      const recallUpdateChunk = pushedChunks.find(
        (c: any) => c.type === AgentOSResponseChunkType.METADATA_UPDATE && c.updates?.longTermMemoryRecall,
      );
      expect(recallUpdateChunk?.updates?.longTermMemoryRecall?.profile).toBe('aggressive');
      expect(recallUpdateChunk?.updates?.longTermMemoryRecall?.cadenceTurns).toBe(2);
    });

    it('emits taskOutcome metadata for final turn evaluation', async () => {
      (mockGMI.processTurnStream as any).mockImplementation(async function* (input: GMITurnInput) {
        capturedGMIInput = input;
        yield {
          type: GMIOutputChunkType.TEXT_DELTA,
          content: 'Long answer',
          interactionId: 'interaction-1',
          timestamp: new Date(),
        } as GMIOutputChunk;
        yield {
          type: GMIOutputChunkType.FINAL_RESPONSE_MARKER,
          content: { finalResponseText: 'Long answer' },
          interactionId: 'interaction-1',
          timestamp: new Date(),
          isFinal: true,
        } as GMIOutputChunk;
        return {
          isFinal: true,
          responseText:
            'This response fully addresses the request with concrete implementation details and next actions.',
        };
      });

      const input: AgentOSInput = {
        userId: 'test-user',
        sessionId: 'task-outcome-session',
        textInput: 'Please complete the task',
        selectedPersonaId: 'persona-1',
      };

      await orchestrator.orchestrateTurn(input);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const pushedChunks = (mockStreamingManager.pushChunk as any).mock.calls.map((call: any[]) => call[1]);
      const taskOutcomeChunk = pushedChunks.find(
        (c: any) => c.type === AgentOSResponseChunkType.METADATA_UPDATE && c.updates?.taskOutcome,
      );

      expect(taskOutcomeChunk).toBeTruthy();
      expect(taskOutcomeChunk.updates.taskOutcome.status).toBe('success');
      expect(taskOutcomeChunk.updates.taskOutcome.score).toBeGreaterThan(0.8);
    });

    it('emits rolling taskOutcomeKpi payload with running success stats', async () => {
      await orchestrator.shutdown();
      await orchestrator.initialize(
        {
          maxToolCallIterations: 5,
          defaultAgentTurnTimeoutMs: 120000,
          taskOutcomeTelemetry: {
            enabled: true,
            scope: 'global',
            rollingWindowSize: 10,
          },
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

      (mockGMI.processTurnStream as any).mockImplementation(async function* () {
        yield {
          type: GMIOutputChunkType.TEXT_DELTA,
          content: 'Done.',
          interactionId: 'interaction-1',
          timestamp: new Date(),
        } as GMIOutputChunk;
        yield {
          type: GMIOutputChunkType.FINAL_RESPONSE_MARKER,
          content: { finalResponseText: 'Done.' },
          interactionId: 'interaction-1',
          timestamp: new Date(),
          isFinal: true,
        } as GMIOutputChunk;
        return {
          isFinal: true,
          responseText:
            'Completed successfully with a full response payload that exceeds the success threshold.',
        };
      });

      await orchestrator.orchestrateTurn({
        userId: 'test-user',
        sessionId: 'kpi-session-1',
        textInput: 'first task',
        selectedPersonaId: 'persona-1',
      });
      await new Promise((resolve) => setTimeout(resolve, 90));

      await orchestrator.orchestrateTurn({
        userId: 'test-user',
        sessionId: 'kpi-session-2',
        textInput: 'second task',
        selectedPersonaId: 'persona-1',
      });
      await new Promise((resolve) => setTimeout(resolve, 90));

      const pushedChunks = (mockStreamingManager.pushChunk as any).mock.calls.map((call: any[]) => call[1]);
      const kpiChunks = pushedChunks.filter(
        (c: any) => c.type === AgentOSResponseChunkType.METADATA_UPDATE && c.updates?.taskOutcomeKpi,
      );
      expect(kpiChunks.length).toBeGreaterThanOrEqual(2);
      const lastKpi = kpiChunks[kpiChunks.length - 1].updates.taskOutcomeKpi;
      expect(lastKpi.scopeKey).toBe('global');
      expect(lastKpi.sampleCount).toBe(2);
      expect(lastKpi.successCount).toBe(2);
      expect(lastKpi.failedCount).toBe(0);
      expect(lastKpi.successRate).toBe(1);
      expect(lastKpi.weightedSuccessRate).toBeGreaterThan(0.8);
    });

    it('adapts discovered tool selection to all tools when rolling success degrades', async () => {
      await orchestrator.shutdown();
      const mockTurnPlanner = {
        plannerId: 'planner-test',
        isDiscoveryAvailable: vi.fn().mockReturnValue(true),
        planTurn: vi.fn().mockImplementation(async () => ({
          policy: {
            plannerVersion: 'planner-test',
            toolFailureMode: 'fail_open',
            toolSelectionMode: 'discovered',
          },
          capability: {
            enabled: true,
            query: 'test',
            kind: 'any',
            onlyAvailable: true,
            selectedToolNames: ['web-search'],
          },
          diagnostics: {
            planningLatencyMs: 1,
            discoveryAttempted: true,
            discoveryApplied: true,
            discoveryAttempts: 1,
            usedFallback: false,
          },
        })),
      };

      await orchestrator.initialize(
        {
          maxToolCallIterations: 5,
          defaultAgentTurnTimeoutMs: 120000,
          taskOutcomeTelemetry: {
            enabled: true,
            scope: 'global',
            rollingWindowSize: 20,
          },
          adaptiveExecution: {
            enabled: true,
            minSamples: 3,
            minWeightedSuccessRate: 0.8,
            forceAllToolsWhenDegraded: true,
          },
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
          turnPlanner: mockTurnPlanner as any,
        }
      );

      for (let i = 0; i < 3; i += 1) {
        await orchestrator.orchestrateTurn({
          userId: 'test-user',
          sessionId: `adaptive-seed-${i}`,
          textInput: `seed ${i}`,
          selectedPersonaId: 'persona-1',
          options: {
            customFlags: { taskOutcome: 'failed' },
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 90));
      }

      await orchestrator.orchestrateTurn({
        userId: 'test-user',
        sessionId: 'adaptive-final',
        textInput: 'should adapt',
        selectedPersonaId: 'persona-1',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedGMIInput?.metadata?.executionPolicy?.toolSelectionMode).toBe('all');
      const pushedChunks = (mockStreamingManager.pushChunk as any).mock.calls.map((call: any[]) => call[1]);
      const planningChunks = pushedChunks.filter(
        (c: any) => c.type === AgentOSResponseChunkType.METADATA_UPDATE && c.updates?.turnPlanning,
      );
      const planningChunk = planningChunks[planningChunks.length - 1];
      expect(planningChunk?.updates?.turnPlanning?.adaptiveExecution?.applied).toBe(true);
    });

    it('forces fail_open under degraded KPI when fail_closed was not explicitly requested', async () => {
      await orchestrator.shutdown();
      const mockTurnPlanner = {
        plannerId: 'planner-test',
        isDiscoveryAvailable: vi.fn().mockReturnValue(true),
        planTurn: vi.fn().mockImplementation(async () => ({
          policy: {
            plannerVersion: 'planner-test',
            toolFailureMode: 'fail_closed',
            toolSelectionMode: 'all',
          },
          capability: {
            enabled: true,
            query: 'test',
            kind: 'any',
            onlyAvailable: true,
            selectedToolNames: ['web-search'],
          },
          diagnostics: {
            planningLatencyMs: 1,
            discoveryAttempted: true,
            discoveryApplied: true,
            discoveryAttempts: 1,
            usedFallback: false,
          },
        })),
      };

      await orchestrator.initialize(
        {
          maxToolCallIterations: 5,
          defaultAgentTurnTimeoutMs: 120000,
          taskOutcomeTelemetry: {
            enabled: true,
            scope: 'global',
            rollingWindowSize: 20,
          },
          adaptiveExecution: {
            enabled: true,
            minSamples: 3,
            minWeightedSuccessRate: 0.8,
            forceAllToolsWhenDegraded: true,
            forceFailOpenWhenDegraded: true,
          },
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
          turnPlanner: mockTurnPlanner as any,
        }
      );

      for (let i = 0; i < 3; i += 1) {
        await orchestrator.orchestrateTurn({
          userId: 'test-user',
          sessionId: `adaptive-fail-open-seed-${i}`,
          textInput: `seed ${i}`,
          selectedPersonaId: 'persona-1',
          options: {
            customFlags: { taskOutcome: 'failed' },
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 90));
      }

      await orchestrator.orchestrateTurn({
        userId: 'test-user',
        sessionId: 'adaptive-fail-open-final',
        textInput: 'should force fail_open',
        selectedPersonaId: 'persona-1',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedGMIInput?.metadata?.executionPolicy?.toolFailureMode).toBe('fail_open');
      const pushedChunks = (mockStreamingManager.pushChunk as any).mock.calls.map((call: any[]) => call[1]);
      const planningChunks = pushedChunks.filter(
        (c: any) => c.type === AgentOSResponseChunkType.METADATA_UPDATE && c.updates?.turnPlanning,
      );
      const planningChunk = planningChunks[planningChunks.length - 1];
      expect(planningChunk?.updates?.turnPlanning?.adaptiveExecution?.actions?.forcedToolFailureMode).toBe(true);
    });

    it('preserves explicit fail_closed request override under degraded KPI', async () => {
      await orchestrator.shutdown();
      const mockTurnPlanner = {
        plannerId: 'planner-test',
        isDiscoveryAvailable: vi.fn().mockReturnValue(true),
        planTurn: vi.fn().mockImplementation(async () => ({
          policy: {
            plannerVersion: 'planner-test',
            toolFailureMode: 'fail_closed',
            toolSelectionMode: 'all',
          },
          capability: {
            enabled: true,
            query: 'test',
            kind: 'any',
            onlyAvailable: true,
            selectedToolNames: ['web-search'],
          },
          diagnostics: {
            planningLatencyMs: 1,
            discoveryAttempted: true,
            discoveryApplied: true,
            discoveryAttempts: 1,
            usedFallback: false,
          },
        })),
      };

      await orchestrator.initialize(
        {
          maxToolCallIterations: 5,
          defaultAgentTurnTimeoutMs: 120000,
          taskOutcomeTelemetry: {
            enabled: true,
            scope: 'global',
            rollingWindowSize: 20,
          },
          adaptiveExecution: {
            enabled: true,
            minSamples: 3,
            minWeightedSuccessRate: 0.8,
            forceAllToolsWhenDegraded: true,
            forceFailOpenWhenDegraded: true,
          },
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
          turnPlanner: mockTurnPlanner as any,
        }
      );

      for (let i = 0; i < 3; i += 1) {
        await orchestrator.orchestrateTurn({
          userId: 'test-user',
          sessionId: `adaptive-preserve-closed-seed-${i}`,
          textInput: `seed ${i}`,
          selectedPersonaId: 'persona-1',
          options: {
            customFlags: { taskOutcome: 'failed' },
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 90));
      }

      await orchestrator.orchestrateTurn({
        userId: 'test-user',
        sessionId: 'adaptive-preserve-closed-final',
        textInput: 'keep explicit fail_closed',
        selectedPersonaId: 'persona-1',
        options: {
          customFlags: {
            toolFailureMode: 'fail_closed',
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedGMIInput?.metadata?.executionPolicy?.toolFailureMode).toBe('fail_closed');
      const pushedChunks = (mockStreamingManager.pushChunk as any).mock.calls.map((call: any[]) => call[1]);
      const planningChunks = pushedChunks.filter(
        (c: any) => c.type === AgentOSResponseChunkType.METADATA_UPDATE && c.updates?.turnPlanning,
      );
      const planningChunk = planningChunks[planningChunks.length - 1];
      expect(planningChunk?.updates?.turnPlanning?.adaptiveExecution?.applied).toBe(false);
      expect(
        planningChunk?.updates?.turnPlanning?.adaptiveExecution?.actions?.preservedRequestedFailClosed,
      ).toBe(true);
      expect(planningChunk?.updates?.turnPlanning?.adaptiveExecution?.actions?.forcedToolFailureMode).toBeFalsy();
    });

    it('loads persisted KPI windows and applies adaptive execution on first turn', async () => {
      await orchestrator.shutdown();
      const mockTurnPlanner = {
        plannerId: 'planner-test',
        isDiscoveryAvailable: vi.fn().mockReturnValue(true),
        planTurn: vi.fn().mockImplementation(async () => ({
          policy: {
            plannerVersion: 'planner-test',
            toolFailureMode: 'fail_open',
            toolSelectionMode: 'discovered',
          },
          capability: {
            enabled: true,
            query: 'test',
            kind: 'any',
            onlyAvailable: true,
            selectedToolNames: ['web-search'],
          },
          diagnostics: {
            planningLatencyMs: 1,
            discoveryAttempted: true,
            discoveryApplied: true,
            discoveryAttempts: 1,
            usedFallback: false,
          },
        })),
      };
      const mockTelemetryStore = {
        loadWindows: vi.fn().mockResolvedValue({
          global: [
            { status: 'failed', score: 0, timestamp: 100 },
            { status: 'failed', score: 0, timestamp: 200 },
            { status: 'failed', score: 0, timestamp: 300 },
          ],
        }),
        saveWindow: vi.fn().mockResolvedValue(undefined),
      };

      await orchestrator.initialize(
        {
          maxToolCallIterations: 5,
          defaultAgentTurnTimeoutMs: 120000,
          taskOutcomeTelemetry: {
            enabled: true,
            scope: 'global',
            rollingWindowSize: 20,
          },
          adaptiveExecution: {
            enabled: true,
            minSamples: 3,
            minWeightedSuccessRate: 0.8,
            forceAllToolsWhenDegraded: true,
          },
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
          turnPlanner: mockTurnPlanner as any,
          taskOutcomeTelemetryStore: mockTelemetryStore as any,
        }
      );

      await orchestrator.orchestrateTurn({
        userId: 'test-user',
        sessionId: 'persisted-kpi-seed',
        textInput: 'should adapt immediately',
        selectedPersonaId: 'persona-1',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTelemetryStore.loadWindows).toHaveBeenCalled();
      expect(capturedGMIInput?.metadata?.executionPolicy?.toolSelectionMode).toBe('all');
    });

    it('persists KPI window updates via taskOutcomeTelemetryStore', async () => {
      await orchestrator.shutdown();
      const mockTelemetryStore = {
        loadWindows: vi.fn().mockResolvedValue({}),
        saveWindow: vi.fn().mockResolvedValue(undefined),
      };

      await orchestrator.initialize(
        {
          maxToolCallIterations: 5,
          defaultAgentTurnTimeoutMs: 120000,
          taskOutcomeTelemetry: {
            enabled: true,
            scope: 'global',
            rollingWindowSize: 10,
          },
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
          taskOutcomeTelemetryStore: mockTelemetryStore as any,
        }
      );

      await orchestrator.orchestrateTurn({
        userId: 'test-user',
        sessionId: 'persist-kpi-1',
        textInput: 'complete this',
        selectedPersonaId: 'persona-1',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTelemetryStore.saveWindow).toHaveBeenCalled();
      const [scopeKey, entries] = mockTelemetryStore.saveWindow.mock.calls[0];
      expect(scopeKey).toBe('global');
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);
    });

    it('emits taskOutcomeAlert when weighted success drops below threshold', async () => {
      await orchestrator.shutdown();
      await orchestrator.initialize(
        {
          maxToolCallIterations: 5,
          defaultAgentTurnTimeoutMs: 120000,
          taskOutcomeTelemetry: {
            enabled: true,
            scope: 'global',
            rollingWindowSize: 20,
            emitAlerts: true,
            alertBelowWeightedSuccessRate: 0.9,
            alertMinSamples: 2,
            alertCooldownMs: 0,
          },
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

      await orchestrator.orchestrateTurn({
        userId: 'test-user',
        sessionId: 'alert-seed-1',
        textInput: 'seed fail 1',
        selectedPersonaId: 'persona-1',
        options: { customFlags: { taskOutcome: 'failed' } },
      });
      await new Promise((resolve) => setTimeout(resolve, 90));

      await orchestrator.orchestrateTurn({
        userId: 'test-user',
        sessionId: 'alert-seed-2',
        textInput: 'seed fail 2',
        selectedPersonaId: 'persona-1',
        options: { customFlags: { taskOutcome: 'failed' } },
      });
      await new Promise((resolve) => setTimeout(resolve, 90));

      const pushedChunks = (mockStreamingManager.pushChunk as any).mock.calls.map((call: any[]) => call[1]);
      const alertChunk = pushedChunks.find(
        (c: any) => c.type === AgentOSResponseChunkType.METADATA_UPDATE && c.updates?.taskOutcomeAlert,
      );
      expect(alertChunk).toBeTruthy();
      expect(alertChunk.updates.taskOutcomeAlert.sampleCount).toBeGreaterThanOrEqual(2);
      expect(alertChunk.updates.taskOutcomeAlert.value).toBeLessThan(0.9);
    });
  });
});
