/**
 * @file agency-types.test.ts
 * Compile-time and runtime verification for the Agency API type definitions.
 *
 * These tests confirm that:
 * - All exported types are importable and structurally correct.
 * - Discriminated unions on `AgencyStreamPart` are correctly narrowed.
 * - `AgencyConfigError` is a proper `Error` subclass.
 * - `BaseAgentConfig` and `AgencyOptions` accept valid configurations.
 */

import { describe, expect, it } from 'vitest';
import type {
  SecurityTier,
  MemoryType,
  AgencyStrategy,
  BaseAgentConfig,
  AgencyOptions,
  AgencyStreamPart,
  AgencyTraceEvent,
  AgentCallRecord,
  ApprovalRequest,
  ApprovalDecision,
  AgentStartEvent,
  AgentEndEvent,
  HandoffEvent,
  ToolCallEvent,
  ForgeEvent,
  GuardrailEvent,
  LimitEvent,
  AgencyCallbacks,
  MemoryConfig,
  RagConfig,
  DiscoveryConfig,
  GuardrailsConfig,
  PermissionsConfig,
  HitlConfig,
  EmergentConfig,
  VoiceConfig,
  ProvenanceConfig,
  ObservabilityConfig,
  ResourceControls,
  CompiledStrategy,
  Agent,
  Agency,
} from '../types.js';
import { AgencyConfigError } from '../types.js';

// ---------------------------------------------------------------------------
// AgencyConfigError — runtime class behaviour
// ---------------------------------------------------------------------------

describe('AgencyConfigError', () => {
  it('is an instance of Error', () => {
    const err = new AgencyConfigError('bad config');
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of AgencyConfigError', () => {
    const err = new AgencyConfigError('bad config');
    expect(err).toBeInstanceOf(AgencyConfigError);
  });

  it('sets the message correctly', () => {
    const msg = 'agents field is required';
    const err = new AgencyConfigError(msg);
    expect(err.message).toBe(msg);
  });

  it('sets name to "AgencyConfigError"', () => {
    const err = new AgencyConfigError('oops');
    expect(err.name).toBe('AgencyConfigError');
  });

  it('can be caught as an Error', () => {
    expect(() => { throw new AgencyConfigError('thrown'); }).toThrow(Error);
  });

  it('can be caught as an AgencyConfigError', () => {
    expect(() => { throw new AgencyConfigError('thrown'); }).toThrow(AgencyConfigError);
  });
});

// ---------------------------------------------------------------------------
// AgencyStreamPart — discriminated union narrowing
// ---------------------------------------------------------------------------

describe('AgencyStreamPart discriminated union', () => {
  /**
   * Helper that accepts a typed `AgencyStreamPart` and returns the
   * discriminant together with any type-specific payload fields.
   */
  function describeStreamPart(part: AgencyStreamPart): string {
    switch (part.type) {
      case 'text':
        return `text:${part.text}`;
      case 'tool-call':
        return `tool-call:${part.toolName}`;
      case 'tool-result':
        return `tool-result:${part.toolName}`;
      case 'error':
        return `error:${part.error.message}`;
      case 'agent-start':
        return `agent-start:${part.agent}`;
      case 'agent-end':
        return `agent-end:${part.agent}`;
      case 'agent-handoff':
        return `agent-handoff:${part.fromAgent}->${part.toAgent}`;
      case 'strategy-override':
        return `strategy-override:${part.original}->${part.chosen}`;
      case 'emergent-forge':
        return `emergent-forge:${part.agentName}`;
      case 'guardrail-result':
        return `guardrail-result:${part.guardrailId}`;
      case 'approval-requested':
        return `approval-requested:${part.request.id}`;
      case 'approval-decided':
        return `approval-decided:${part.requestId}`;
      case 'permission-denied':
        return `permission-denied:${part.action}`;
    }
  }

  it('narrows "text" parts correctly', () => {
    const part: AgencyStreamPart = { type: 'text', text: 'hello' };
    expect(describeStreamPart(part)).toBe('text:hello');
  });

  it('narrows "tool-call" parts correctly', () => {
    const part: AgencyStreamPart = { type: 'tool-call', toolName: 'search', args: { q: 'test' }, agent: 'researcher' };
    expect(describeStreamPart(part)).toBe('tool-call:search');
  });

  it('narrows "tool-result" parts correctly', () => {
    const part: AgencyStreamPart = { type: 'tool-result', toolName: 'search', result: ['r1'], agent: 'researcher' };
    expect(describeStreamPart(part)).toBe('tool-result:search');
  });

  it('narrows "error" parts correctly', () => {
    const part: AgencyStreamPart = { type: 'error', error: new Error('boom') };
    expect(describeStreamPart(part)).toBe('error:boom');
  });

  it('narrows "agent-start" parts correctly', () => {
    const part: AgencyStreamPart = { type: 'agent-start', agent: 'writer', input: 'Draft an intro.' };
    expect(describeStreamPart(part)).toBe('agent-start:writer');
  });

  it('narrows "agent-end" parts correctly', () => {
    const part: AgencyStreamPart = { type: 'agent-end', agent: 'writer', output: 'Done.', durationMs: 320 };
    expect(describeStreamPart(part)).toBe('agent-end:writer');
  });

  it('narrows "agent-handoff" parts correctly', () => {
    const part: AgencyStreamPart = { type: 'agent-handoff', fromAgent: 'planner', toAgent: 'executor', reason: 'task ready' };
    expect(describeStreamPart(part)).toBe('agent-handoff:planner->executor');
  });

  it('narrows "strategy-override" parts correctly', () => {
    const part: AgencyStreamPart = { type: 'strategy-override', original: 'sequential', chosen: 'parallel', reason: 'independent tasks detected' };
    expect(describeStreamPart(part)).toBe('strategy-override:sequential->parallel');
  });

  it('narrows "emergent-forge" parts correctly', () => {
    const part: AgencyStreamPart = { type: 'emergent-forge', agentName: 'specialist-42', instructions: 'Focus on legal analysis.', approved: true };
    expect(describeStreamPart(part)).toBe('emergent-forge:specialist-42');
  });

  it('narrows "guardrail-result" parts correctly', () => {
    const part: AgencyStreamPart = { type: 'guardrail-result', agent: 'writer', guardrailId: 'pii-block', passed: true, action: 'allow' };
    expect(describeStreamPart(part)).toBe('guardrail-result:pii-block');
  });

  it('narrows "approval-requested" parts correctly', () => {
    const request: ApprovalRequest = {
      id: 'req-1',
      type: 'tool',
      agent: 'executor',
      action: 'deletefile',
      description: 'Delete /tmp/x',
      details: { path: '/tmp/x' },
      context: { agentCalls: [], totalTokens: 100, totalCostUSD: 0.01, elapsedMs: 500 },
    };
    const part: AgencyStreamPart = { type: 'approval-requested', request };
    expect(describeStreamPart(part)).toBe('approval-requested:req-1');
  });

  it('narrows "approval-decided" parts correctly', () => {
    const part: AgencyStreamPart = { type: 'approval-decided', requestId: 'req-1', approved: true };
    expect(describeStreamPart(part)).toBe('approval-decided:req-1');
  });

  it('narrows "permission-denied" parts correctly', () => {
    const part: AgencyStreamPart = { type: 'permission-denied', agent: 'rogue', action: 'spawn', reason: 'tier:strict forbids spawn' };
    expect(describeStreamPart(part)).toBe('permission-denied:spawn');
  });
});

// ---------------------------------------------------------------------------
// Scalar union types — valid literal values compile and round-trip
// ---------------------------------------------------------------------------

describe('SecurityTier literals', () => {
  const tiers: SecurityTier[] = ['dangerous', 'permissive', 'balanced', 'strict', 'paranoid'];
  it('has exactly 5 members', () => {
    expect(tiers).toHaveLength(5);
  });
  it.each(tiers)('"%s" is a non-empty string', (tier) => {
    expect(typeof tier).toBe('string');
    expect(tier.length).toBeGreaterThan(0);
  });
});

describe('MemoryType literals', () => {
  const types: MemoryType[] = ['episodic', 'semantic', 'procedural', 'prospective'];
  it('has exactly 4 members', () => {
    expect(types).toHaveLength(4);
  });
});

describe('AgencyStrategy literals', () => {
  const strategies: AgencyStrategy[] = ['sequential', 'parallel', 'debate', 'review-loop', 'hierarchical'];
  it('has exactly 5 members', () => {
    expect(strategies).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// BaseAgentConfig — structural validity at runtime
// ---------------------------------------------------------------------------

describe('BaseAgentConfig structural shapes', () => {
  it('accepts a minimal config', () => {
    const cfg: BaseAgentConfig = { model: 'openai:gpt-4o' };
    expect(cfg.model).toBe('openai:gpt-4o');
  });

  it('accepts boolean memory shorthand', () => {
    const cfg: BaseAgentConfig = { memory: false };
    expect(cfg.memory).toBe(false);
  });

  it('accepts MemoryConfig object', () => {
    const mem: MemoryConfig = {
      shared: true,
      types: ['episodic', 'semantic'],
      working: { enabled: true, maxTokens: 4096, strategy: 'sliding-window' },
      consolidation: { enabled: true, interval: 'PT1H' },
    };
    const cfg: BaseAgentConfig = { memory: mem };
    expect((cfg.memory as MemoryConfig).shared).toBe(true);
  });

  it('accepts guardrails as string[]', () => {
    const cfg: BaseAgentConfig = { guardrails: ['pii-block', 'toxicity'] };
    expect(Array.isArray(cfg.guardrails)).toBe(true);
  });

  it('accepts guardrails as GuardrailsConfig', () => {
    const gc: GuardrailsConfig = { input: ['pii-block'], output: ['toxicity'], tier: 'strict' };
    const cfg: BaseAgentConfig = { guardrails: gc };
    expect((cfg.guardrails as GuardrailsConfig).tier).toBe('strict');
  });

  it('accepts a full PermissionsConfig', () => {
    const perms: PermissionsConfig = {
      tools: ['search', 'calculator'],
      network: true,
      filesystem: false,
      spawn: false,
      requireApproval: ['deletefile'],
    };
    const cfg: BaseAgentConfig = { permissions: perms };
    expect((cfg.permissions as PermissionsConfig).network).toBe(true);
  });

  it('accepts a full VoiceConfig', () => {
    const voice: VoiceConfig = {
      enabled: true,
      transport: 'streaming',
      stt: 'deepgram',
      tts: 'elevenlabs',
      ttsVoice: 'rachel',
      language: 'en-US',
      diarization: false,
    };
    const cfg: BaseAgentConfig = { voice };
    expect((cfg.voice as VoiceConfig).stt).toBe('deepgram');
  });

  it('accepts ProvenanceConfig with solana export', () => {
    const prov: ProvenanceConfig = { enabled: true, hashChain: true, export: 'solana' };
    const cfg: BaseAgentConfig = { provenance: prov };
    expect((cfg.provenance as ProvenanceConfig).export).toBe('solana');
  });

  it('accepts ResourceControls', () => {
    const controls: ResourceControls = {
      maxTotalTokens: 100_000,
      maxCostUSD: 2.50,
      maxDurationMs: 30_000,
      onLimitReached: 'stop',
    };
    const cfg: BaseAgentConfig = { controls };
    expect((cfg.controls as ResourceControls).maxCostUSD).toBe(2.50);
  });

  it('accepts ObservabilityConfig', () => {
    const obs: ObservabilityConfig = { logLevel: 'debug', traceEvents: true, otel: { enabled: true } };
    const cfg: BaseAgentConfig = { observability: obs };
    expect((cfg.observability as ObservabilityConfig).logLevel).toBe('debug');
  });

  it('accepts DiscoveryConfig', () => {
    const disc: DiscoveryConfig = { enabled: true, kinds: ['tool', 'skill'], profile: 'balanced' };
    const cfg: BaseAgentConfig = { discovery: disc };
    expect((cfg.discovery as DiscoveryConfig).profile).toBe('balanced');
  });

  it('accepts RagConfig', () => {
    const rag: RagConfig = {
      vectorStore: { provider: 'pinecone', embeddingModel: 'text-embedding-3-small' },
      topK: 5,
      minScore: 0.75,
    };
    const cfg: BaseAgentConfig = { rag };
    expect((cfg.rag as RagConfig).topK).toBe(5);
  });

  it('accepts EmergentConfig', () => {
    const em: EmergentConfig = { enabled: true, tier: 'session', judge: true };
    const cfg: BaseAgentConfig = { emergent: em };
    expect((cfg.emergent as EmergentConfig).tier).toBe('session');
  });

  it('accepts AgencyCallbacks', () => {
    const events: string[] = [];
    const callbacks: AgencyCallbacks = {
      agentStart: (e: AgentStartEvent) => { events.push(`start:${e.agent}`); },
      agentEnd: (e: AgentEndEvent) => { events.push(`end:${e.agent}`); },
      handoff: (e: HandoffEvent) => { events.push(`handoff:${e.fromAgent}`); },
      toolCall: (e: ToolCallEvent) => { events.push(`tool:${e.toolName}`); },
      emergentForge: (e: ForgeEvent) => { events.push(`forge:${e.agentName}`); },
      guardrailResult: (e: GuardrailEvent) => { events.push(`guard:${e.guardrailId}`); },
      limitReached: (e: LimitEvent) => { events.push(`limit:${e.metric}`); },
    };

    // Fire them to confirm runtime shapes are valid
    callbacks.agentStart!({ agent: 'a', input: 'hi', timestamp: 0 });
    callbacks.agentEnd!({ agent: 'a', output: 'bye', durationMs: 100, timestamp: 1 });
    callbacks.handoff!({ fromAgent: 'a', toAgent: 'b', reason: 'done', timestamp: 2 });
    callbacks.toolCall!({ agent: 'a', toolName: 'search', args: {}, timestamp: 3 });
    callbacks.emergentForge!({ agentName: 'z', instructions: 'do stuff', approved: true, timestamp: 4 });
    callbacks.guardrailResult!({ agent: 'a', guardrailId: 'pii', passed: true, action: 'allow', timestamp: 5 });
    callbacks.limitReached!({ metric: 'maxCostUSD', value: 3.01, limit: 3.00, timestamp: 6 });

    expect(events).toEqual([
      'start:a',
      'end:a',
      'handoff:a',
      'tool:search',
      'forge:z',
      'guard:pii',
      'limit:maxCostUSD',
    ]);
  });
});

// ---------------------------------------------------------------------------
// AgencyOptions
// ---------------------------------------------------------------------------

describe('AgencyOptions', () => {
  it('requires agents and accepts strategy', () => {
    const opts: AgencyOptions = {
      agents: {
        planner: { model: 'openai:gpt-4o', instructions: 'Plan tasks.' },
        executor: { model: 'openai:gpt-4o-mini', instructions: 'Execute tasks.' },
      },
      strategy: 'sequential',
      maxRounds: 3,
    };
    expect(Object.keys(opts.agents)).toHaveLength(2);
    expect(opts.strategy).toBe('sequential');
    expect(opts.maxRounds).toBe(3);
  });

  it('accepts adaptive flag', () => {
    const opts: AgencyOptions = { agents: { solo: {} }, adaptive: true };
    expect(opts.adaptive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AgentCallRecord
// ---------------------------------------------------------------------------

describe('AgentCallRecord', () => {
  it('constructs a valid record', () => {
    const record: AgentCallRecord = {
      agent: 'researcher',
      input: 'find papers on LLMs',
      output: 'Found 10 papers.',
      toolCalls: [{ name: 'search', args: { q: 'LLMs' }, result: ['p1', 'p2'] }],
      guardrailResults: [{ id: 'pii-block', passed: true, action: 'allow' }],
      usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280, costUSD: 0.005 },
      durationMs: 1250,
      emergent: false,
    };
    expect(record.usage.totalTokens).toBe(280);
    expect(record.toolCalls[0].name).toBe('search');
    expect(record.guardrailResults![0].passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HitlConfig handler invocation
// ---------------------------------------------------------------------------

describe('HitlConfig', () => {
  it('handler resolves an ApprovalDecision', async () => {
    const hitl: HitlConfig = {
      approvals: { beforeTool: ['deletefile'], beforeEmergent: true },
      timeoutMs: 5000,
      onTimeout: 'reject',
      handler: async (req: ApprovalRequest): Promise<ApprovalDecision> => ({
        approved: req.action !== 'danger',
        reason: 'automated test decision',
      }),
    };

    const req: ApprovalRequest = {
      id: 'req-42',
      type: 'tool',
      agent: 'executor',
      action: 'search',
      description: 'Web search',
      details: { query: 'test' },
      context: { agentCalls: [], totalTokens: 50, totalCostUSD: 0.001, elapsedMs: 100 },
    };

    const decision = await hitl.handler!(req);
    expect(decision.approved).toBe(true);
    expect(decision.reason).toBe('automated test decision');
  });
});

// ---------------------------------------------------------------------------
// AgencyTraceEvent — all variants compile and are narrowable
// ---------------------------------------------------------------------------

describe('AgencyTraceEvent union', () => {
  function labelEvent(e: AgencyTraceEvent): string {
    if ('input' in e && 'agent' in e && !('output' in e)) return `start:${e.agent}`;
    if ('output' in e && 'durationMs' in e) return `end:${(e as AgentEndEvent).agent}`;
    if ('fromAgent' in e) return `handoff:${(e as HandoffEvent).fromAgent}`;
    if ('toolName' in e) return `tool:${(e as ToolCallEvent).toolName}`;
    if ('agentName' in e) return `forge:${(e as ForgeEvent).agentName}`;
    if ('guardrailId' in e) return `guard:${(e as GuardrailEvent).guardrailId}`;
    if ('metric' in e) return `limit:${(e as LimitEvent).metric}`;
    return 'unknown';
  }

  it('correctly labels all 7 event shapes', () => {
    const events: AgencyTraceEvent[] = [
      { agent: 'a', input: 'hi', timestamp: 0 } satisfies AgentStartEvent,
      { agent: 'a', output: 'bye', durationMs: 100, timestamp: 1 } satisfies AgentEndEvent,
      { fromAgent: 'a', toAgent: 'b', reason: 'done', timestamp: 2 } satisfies HandoffEvent,
      { agent: 'a', toolName: 'calc', args: {}, timestamp: 3 } satisfies ToolCallEvent,
      { agentName: 'z', instructions: '...', approved: true, timestamp: 4 } satisfies ForgeEvent,
      { agent: 'a', guardrailId: 'pii', passed: true, action: 'allow', timestamp: 5 } satisfies GuardrailEvent,
      { metric: 'maxCostUSD', value: 3.01, limit: 3.0, timestamp: 6 } satisfies LimitEvent,
    ];

    const labels = events.map(labelEvent);
    expect(labels).toEqual([
      'start:a',
      'end:a',
      'handoff:a',
      'tool:calc',
      'forge:z',
      'guard:pii',
      'limit:maxCostUSD',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Type-level smoke test: Agent and Agency are structurally equivalent
// ---------------------------------------------------------------------------

describe('Agent / Agency structural equivalence', () => {
  it('an Agency-typed value satisfies the Agent interface at runtime', () => {
    // Minimal mock that satisfies both interfaces
    const mockAgency: Agency = {
      async generate(_prompt: string) { return { text: 'ok' }; },
      stream(_prompt: string) { return {}; },
      session(_id?: string) { return {}; },
      async usage(_sessionId?: string) { return {}; },
      async close() { /* no-op */ },
      async listen(_opts?: { port?: number }) { return { port: 3000, url: 'http://localhost:3000', close: async () => {} }; },
      async connect() { /* no-op */ },
    };

    // Agency satisfies Agent
    const asAgent: Agent = mockAgency;
    expect(typeof asAgent.generate).toBe('function');
    expect(typeof asAgent.close).toBe('function');
  });
});
