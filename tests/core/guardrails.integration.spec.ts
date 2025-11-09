import { describe, it, expect, vi } from 'vitest';
import { AgentOS } from '../../src/api/AgentOS';
import type { AgentOSConfig } from '../../src/api/AgentOS';
import type { AgentOSInput } from '../../src/api/types/AgentOSInput';
import {
  AgentOSResponse,
  AgentOSResponseChunkType,
  type AgentOSFinalResponseChunk,
  type AgentOSErrorChunk,
} from '../../src/api/types/AgentOSResponse';
import type { IStreamClient, StreamClientId } from '../../src/core/streaming/IStreamClient';
import type { StreamId } from '../../src/core/streaming/StreamingManager';
import type { ILogger } from '../../src/logging/ILogger';
import {
  GuardrailAction,
  type GuardrailEvaluationResult,
  type GuardrailInputPayload,
  type GuardrailOutputPayload,
  type IGuardrailService,
} from '../../src/core/guardrails/IGuardrailService';

class FakeStreamingManager {
  private readonly prepared = new Map<StreamId, AgentOSResponse[]>();
  private readonly clients = new Map<StreamId, IStreamClient[]>();

  public prepareStream(streamId: StreamId, responses: AgentOSResponse[]): void {
    this.prepared.set(
      streamId,
      responses.map((chunk) => ({
        ...chunk,
        metadata: chunk.metadata ? { ...chunk.metadata } : undefined,
      })),
    );
  }

  public async registerClient(streamId: StreamId, client: IStreamClient): Promise<void> {
    const registered = this.clients.get(streamId) ?? [];
    registered.push(client);
    this.clients.set(streamId, registered);

    const responses = this.prepared.get(streamId);
    if (!responses) {
      return;
    }

    for (const chunk of responses) {
      await client.sendChunk(chunk);
    }
    await client.notifyStreamClosed();
  }

  public async deregisterClient(streamId: StreamId, clientId: StreamClientId): Promise<void> {
    const registered = this.clients.get(streamId) ?? [];
    this.clients.set(
      streamId,
      registered.filter((client) => client.id !== clientId),
    );
  }
}

class StubOrchestrator {
  public lastInput: AgentOSInput | undefined;
  public callCount = 0;

  constructor(
    private readonly streamingManager: FakeStreamingManager,
    private readonly streamId: StreamId,
    private readonly responses: AgentOSResponse[],
  ) {}

  public async orchestrateTurn(input: AgentOSInput): Promise<StreamId> {
    this.callCount += 1;
    this.lastInput = input;
    this.streamingManager.prepareStream(this.streamId, this.responses);
    return this.streamId;
  }
}

class TestGuardrailService implements IGuardrailService {
  public readonly receivedInputPayloads: GuardrailInputPayload[] = [];
  public readonly receivedOutputPayloads: GuardrailOutputPayload[] = [];

  constructor(
    private readonly options: {
      inputEvaluation?: GuardrailEvaluationResult | null;
      outputEvaluation?: GuardrailEvaluationResult | null;
    },
  ) {}

  public async evaluateInput(payload: GuardrailInputPayload): Promise<GuardrailEvaluationResult | null> {
    this.receivedInputPayloads.push(payload);
    return this.options.inputEvaluation ?? null;
  }

  public async evaluateOutput(payload: GuardrailOutputPayload): Promise<GuardrailEvaluationResult | null> {
    this.receivedOutputPayloads.push(payload);
    return this.options.outputEvaluation ?? null;
  }
}

const baseInput: AgentOSInput = {
  userId: 'user-1',
  sessionId: 'session-1',
  textInput: 'hello world',
  conversationId: 'conversation-1',
  selectedPersonaId: undefined,
  visionInputs: [],
  audioInput: undefined,
  userApiKeys: {},
  userFeedback: undefined,
  options: { customFlags: { source: 'test' } },
};

function buildFinalChunk(streamId: StreamId, personaId: string, text: string): AgentOSFinalResponseChunk {
  return {
    type: AgentOSResponseChunkType.FINAL_RESPONSE,
    streamId,
    gmiInstanceId: 'gmi-1',
    personaId,
    isFinal: true,
    timestamp: new Date().toISOString(),
    finalResponseText: text,
  };
}

function createAgentUnderTest(
  guardrailService: IGuardrailService | undefined,
  streamingManager: FakeStreamingManager,
  orchestrator: StubOrchestrator,
): AgentOS {
  const logger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const agent = new AgentOS(logger) as unknown as {
    initialized: boolean;
    config: AgentOSConfig;
    guardrailService?: IGuardrailService;
    agentOSOrchestrator: StubOrchestrator;
    streamingManager: FakeStreamingManager;
  };

  agent.initialized = true;
  agent.config = {
    defaultPersonaId: 'persona-default',
  } as AgentOSConfig;
  agent.guardrailService = guardrailService;
  agent.agentOSOrchestrator = orchestrator;
  agent.streamingManager = streamingManager;

  return agent as unknown as AgentOS;
}

async function collectResponses(agent: AgentOS, input: AgentOSInput): Promise<AgentOSResponse[]> {
  const outputs: AgentOSResponse[] = [];
  for await (const chunk of agent.processRequest(input)) {
    outputs.push(chunk);
  }
  return outputs;
}

describe('AgentOS.processRequest guardrail integration', () => {
  it('sanitizes input, forwards metadata, and streams sanitized text to the orchestrator', async () => {
    const streamId = 'stream-allow';
    const streamingManager = new FakeStreamingManager();

    const finalChunk = buildFinalChunk(streamId, 'persona-default', 'raw output');
    const orchestrator = new StubOrchestrator(streamingManager, streamId, [finalChunk]);

    const guardrailService = new TestGuardrailService({
      inputEvaluation: {
        action: GuardrailAction.SANITIZE,
        modifiedText: 'clean input',
        reason: 'sanitize profanity',
        reasonCode: 'CLEANSED',
      },
    });

    const agent = createAgentUnderTest(guardrailService, streamingManager, orchestrator);
    const responses = await collectResponses(agent, baseInput);

    expect(orchestrator.callCount).toBe(1);
    expect(orchestrator.lastInput?.textInput).toBe('clean input');

    expect(responses).toHaveLength(1);
    const [chunk] = responses;
    expect(chunk.type).toBe(AgentOSResponseChunkType.FINAL_RESPONSE);
    expect((chunk as AgentOSFinalResponseChunk).finalResponseText).toBe('raw output');
    expect(chunk.metadata?.guardrail?.input?.[0]).toMatchObject({
      action: GuardrailAction.SANITIZE,
      reason: 'sanitize profanity',
      reasonCode: 'CLEANSED',
    });
  });

  it('sanitizes final output chunks when guardrail service requests it', async () => {
    const streamId = 'stream-output-sanitize';
    const streamingManager = new FakeStreamingManager();
    const finalChunk = buildFinalChunk(streamId, 'persona-default', 'raw completion text');
    const orchestrator = new StubOrchestrator(streamingManager, streamId, [finalChunk]);

    const guardrailService = new TestGuardrailService({
      outputEvaluation: {
        action: GuardrailAction.SANITIZE,
        modifiedText: 'policy compliant text',
        reason: 'mask sensitive info',
        reasonCode: 'OUTPUT_SANITISED',
      },
    });

    const agent = createAgentUnderTest(guardrailService, streamingManager, orchestrator);
    const responses = await collectResponses(agent, baseInput);

    expect(responses).toHaveLength(1);
    const [chunk] = responses;
    expect(chunk.type).toBe(AgentOSResponseChunkType.FINAL_RESPONSE);
    expect((chunk as AgentOSFinalResponseChunk).finalResponseText).toBe('policy compliant text');
    expect(chunk.metadata?.guardrail?.output?.[0]).toMatchObject({
      action: GuardrailAction.SANITIZE,
      reason: 'mask sensitive info',
      reasonCode: 'OUTPUT_SANITISED',
    });
  });

  it('short-circuits orchestration when guardrails block the input', async () => {
    const streamId = 'stream-block';
    const streamingManager = new FakeStreamingManager();
    const orchestrator = new StubOrchestrator(streamingManager, streamId, []);

    const guardrailService = new TestGuardrailService({
      inputEvaluation: {
        action: GuardrailAction.BLOCK,
        reason: 'disallowed content',
        reasonCode: 'BLOCKED_CONTENT',
      },
    });

    const agent = createAgentUnderTest(guardrailService, streamingManager, orchestrator);
    const responses = await collectResponses(agent, baseInput);

    expect(orchestrator.callCount).toBe(0);
    expect(responses).toHaveLength(1);
    const [chunk] = responses;
    expect(chunk.type).toBe(AgentOSResponseChunkType.ERROR);
    const errorChunk = chunk as AgentOSErrorChunk;
    expect(errorChunk.code).toBe('BLOCKED_CONTENT');
    expect(errorChunk.details).toMatchObject({
      action: GuardrailAction.BLOCK,
    });
  });

  it('converts final output into an error chunk when guardrails block the response', async () => {
    const streamId = 'stream-output-block';
    const streamingManager = new FakeStreamingManager();
    const finalChunk = buildFinalChunk(streamId, 'persona-default', 'unsafe answer');
    const orchestrator = new StubOrchestrator(streamingManager, streamId, [finalChunk]);

    const guardrailService = new TestGuardrailService({
      outputEvaluation: {
        action: GuardrailAction.BLOCK,
        reason: 'response policy violation',
        reasonCode: 'OUTPUT_BLOCKED',
      },
    });

    const agent = createAgentUnderTest(guardrailService, streamingManager, orchestrator);
    const responses = await collectResponses(agent, baseInput);

    expect(responses).toHaveLength(1);
    const [chunk] = responses;
    expect(chunk.type).toBe(AgentOSResponseChunkType.ERROR);
    const errorChunk = chunk as AgentOSErrorChunk;
    expect(errorChunk.code).toBe('OUTPUT_BLOCKED');
    expect(errorChunk.details).toMatchObject({
      action: GuardrailAction.BLOCK,
    });
  });
});

