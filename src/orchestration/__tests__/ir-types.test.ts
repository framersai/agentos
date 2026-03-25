/**
 * @file ir-types.test.ts
 * @description Tests for the CompiledExecutionGraph IR types.
 *
 * These tests verify:
 * - START/END sentinels have the correct literal values
 * - All types can be constructed without TypeScript errors
 * - Discriminated unions for GraphCondition and NodeExecutorConfig work correctly
 * - Complex composite types (GraphNode, GraphEdge, GraphState, CompiledExecutionGraph)
 *   can be assembled and are structurally valid
 */

import { describe, it, expect } from 'vitest';
import {
  START,
  END,
  type NodeExecutionMode,
  type EffectClass,
  type MemoryTraceType,
  type GraphMemoryScope,
  type MemoryConsistencyMode,
  type GraphCondition,
  type GraphConditionFn,
  type NodeExecutorConfig,
  type RetryPolicy,
  type MemoryPolicy,
  type DiscoveryPolicy,
  type PersonaPolicy,
  type GuardrailPolicy,
  type MemoryView,
  type DiagnosticsView,
  type GraphNode,
  type GraphEdge,
  type GraphState,
  type BuiltinReducer,
  type ReducerFn,
  type StateReducers,
  type CheckpointMetadata,
  type RunInspection,
  type CompiledExecutionGraph,
  type VoiceNodeConfig,
} from '../ir/index.js';

// ---------------------------------------------------------------------------
// Sentinel values
// ---------------------------------------------------------------------------

describe('Sentinel constants', () => {
  it('START equals __START__', () => {
    expect(START).toBe('__START__');
  });

  it('END equals __END__', () => {
    expect(END).toBe('__END__');
  });

  it('START and END are distinct', () => {
    expect(START).not.toBe(END);
  });
});

// ---------------------------------------------------------------------------
// GraphCondition discriminated union
// ---------------------------------------------------------------------------

describe('GraphCondition discriminated union', () => {
  it('accepts a function condition', () => {
    const fn: GraphConditionFn = (state) => state.currentNodeId;
    const condition: GraphCondition = { type: 'function', fn, description: 'route by current node' };
    expect(condition.type).toBe('function');
    // Narrowing works: fn is accessible only after narrowing
    if (condition.type === 'function') {
      expect(typeof condition.fn).toBe('function');
      expect(condition.description).toBe('route by current node');
    }
  });

  it('accepts an expression condition', () => {
    const condition: GraphCondition = {
      type: 'expression',
      expr: "state.scratch.confidence > 0.8 ? 'approve' : 'review'",
    };
    expect(condition.type).toBe('expression');
    if (condition.type === 'expression') {
      expect(typeof condition.expr).toBe('string');
    }
  });

  it('function condition executes against a minimal GraphState', () => {
    const fn: GraphConditionFn = (state) =>
      (state.scratch as { score: number }).score > 0.5 ? 'high' : 'low';
    const condition: GraphCondition = { type: 'function', fn };
    if (condition.type === 'function') {
      const fakeState = {
        input: {},
        scratch: { score: 0.9 },
        memory: {} as MemoryView,
        artifacts: {},
        diagnostics: {} as DiagnosticsView,
        currentNodeId: 'node-a',
        visitedNodes: [],
        iteration: 0,
      } satisfies GraphState;
      expect(condition.fn(fakeState)).toBe('high');
    }
  });
});

// ---------------------------------------------------------------------------
// NodeExecutorConfig discriminated union
// ---------------------------------------------------------------------------

describe('NodeExecutorConfig discriminated union', () => {
  it('accepts gmi config', () => {
    const config: NodeExecutorConfig = {
      type: 'gmi',
      instructions: 'You are a helpful assistant.',
      maxInternalIterations: 5,
      parallelTools: true,
      temperature: 0.7,
      maxTokens: 1024,
    };
    expect(config.type).toBe('gmi');
    if (config.type === 'gmi') {
      expect(config.instructions).toBe('You are a helpful assistant.');
      expect(config.maxInternalIterations).toBe(5);
    }
  });

  it('accepts tool config', () => {
    const config: NodeExecutorConfig = {
      type: 'tool',
      toolName: 'web_search',
      args: { maxResults: 5 },
    };
    expect(config.type).toBe('tool');
    if (config.type === 'tool') {
      expect(config.toolName).toBe('web_search');
    }
  });

  it('accepts extension config', () => {
    const config: NodeExecutorConfig = {
      type: 'extension',
      extensionId: 'github-extension',
      method: 'listPullRequests',
    };
    expect(config.type).toBe('extension');
    if (config.type === 'extension') {
      expect(config.method).toBe('listPullRequests');
    }
  });

  it('accepts human config', () => {
    const config: NodeExecutorConfig = {
      type: 'human',
      prompt: 'Please review and approve the generated plan.',
    };
    expect(config.type).toBe('human');
    if (config.type === 'human') {
      expect(config.prompt).toContain('approve');
    }
  });

  it('accepts guardrail config', () => {
    const config: NodeExecutorConfig = {
      type: 'guardrail',
      guardrailIds: ['grounding-guard', 'pii-filter'],
      onViolation: 'reroute',
      rerouteTarget: 'fallback-node',
    };
    expect(config.type).toBe('guardrail');
    if (config.type === 'guardrail') {
      expect(config.guardrailIds).toHaveLength(2);
      expect(config.rerouteTarget).toBe('fallback-node');
    }
  });

  it('accepts router config', () => {
    const config: NodeExecutorConfig = {
      type: 'router',
      condition: { type: 'expression', expr: "state.scratch.intent === 'search' ? 'search-node' : 'answer-node'" },
    };
    expect(config.type).toBe('router');
    if (config.type === 'router') {
      expect(config.condition.type).toBe('expression');
    }
  });

  it('accepts subgraph config', () => {
    const config: NodeExecutorConfig = {
      type: 'subgraph',
      graphId: 'research-subgraph',
      inputMapping: { 'scratch.query': 'input.topic' },
      outputMapping: { 'artifacts.summary': 'scratch.researchSummary' },
    };
    expect(config.type).toBe('subgraph');
    if (config.type === 'subgraph') {
      expect(config.graphId).toBe('research-subgraph');
    }
  });

  it('discriminates voice config', () => {
    const config: NodeExecutorConfig = {
      type: 'voice',
      voiceConfig: { mode: 'conversation' },
    };
    expect(config.type).toBe('voice');
    if (config.type === 'voice') {
      expect(config.voiceConfig.mode).toBe('conversation');
    }
  });

  it('voice config with all optional fields', () => {
    const config: NodeExecutorConfig = {
      type: 'voice',
      voiceConfig: {
        mode: 'conversation',
        stt: 'deepgram',
        tts: 'elevenlabs',
        voice: 'nova',
        endpointing: 'semantic',
        bargeIn: 'hard-cut',
        diarization: true,
        language: 'en-US',
        maxTurns: 5,
        exitOn: 'keyword',
        exitKeywords: ['goodbye', 'done'],
      },
    };
    expect(config.type).toBe('voice');
  });
});

// ---------------------------------------------------------------------------
// RetryPolicy
// ---------------------------------------------------------------------------

describe('RetryPolicy', () => {
  it('constructs with all fields', () => {
    const policy: RetryPolicy = {
      maxAttempts: 3,
      backoff: 'exponential',
      backoffMs: 500,
      retryOn: ['ECONNRESET', 'ETIMEDOUT'],
    };
    expect(policy.maxAttempts).toBe(3);
    expect(policy.backoff).toBe('exponential');
  });

  it('constructs without optional retryOn', () => {
    const policy: RetryPolicy = { maxAttempts: 1, backoff: 'fixed', backoffMs: 0 };
    expect(policy.retryOn).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Policy interfaces
// ---------------------------------------------------------------------------

describe('MemoryPolicy', () => {
  it('constructs a full read+write policy', () => {
    const policy: MemoryPolicy = {
      consistency: 'snapshot',
      read: {
        types: ['episodic', 'semantic'],
        scope: 'session',
        maxTraces: 10,
        minStrength: 0.4,
        semanticQuery: 'previous research findings',
      },
      write: {
        autoEncode: true,
        type: 'episodic',
        scope: 'persona',
      },
    };
    expect(policy.consistency).toBe('snapshot');
    expect(policy.read?.types).toContain('semantic');
    expect(policy.write?.autoEncode).toBe(true);
  });
});

describe('DiscoveryPolicy', () => {
  it('constructs an enabled policy', () => {
    const policy: DiscoveryPolicy = {
      enabled: true,
      query: 'calendar management',
      kind: 'tool',
      maxResults: 5,
      fallback: 'all',
    };
    expect(policy.enabled).toBe(true);
    expect(policy.kind).toBe('tool');
  });

  it('constructs a disabled policy', () => {
    const policy: DiscoveryPolicy = { enabled: false };
    expect(policy.enabled).toBe(false);
  });
});

describe('PersonaPolicy', () => {
  it('constructs with trait overrides', () => {
    const policy: PersonaPolicy = {
      traits: { openness: 0.9, conscientiousness: 0.7 },
      mood: 'curious',
      adaptStyle: true,
    };
    expect(policy.traits?.openness).toBe(0.9);
  });
});

describe('GuardrailPolicy', () => {
  it('constructs with input and output guardrails', () => {
    const policy: GuardrailPolicy = {
      input: ['prompt-injection-guard'],
      output: ['pii-filter', 'toxicity-filter'],
      onViolation: 'sanitize',
    };
    expect(policy.output).toHaveLength(2);
    expect(policy.onViolation).toBe('sanitize');
  });
});

// ---------------------------------------------------------------------------
// MemoryView and DiagnosticsView
// ---------------------------------------------------------------------------

describe('MemoryView', () => {
  it('constructs a valid view', () => {
    const view: MemoryView = {
      traces: [
        {
          traceId: 'tr-001',
          type: 'episodic',
          content: 'User asked about the weather.',
          strength: 0.85,
          scope: 'conversation',
          createdAt: Date.now(),
          metadata: { source: 'user-message' },
        },
      ],
      pendingWrites: [{ type: 'semantic', content: 'It is sunny.', scope: 'session' }],
      totalTracesRead: 42,
      readLatencyMs: 12,
    };
    expect(view.traces).toHaveLength(1);
    expect(view.traces[0].type).toBe('episodic');
    expect(view.pendingWrites).toHaveLength(1);
  });
});

describe('DiagnosticsView', () => {
  it('constructs a valid view', () => {
    const view: DiagnosticsView = {
      totalTokensUsed: 2048,
      totalDurationMs: 3200,
      nodeTimings: {
        'node-a': { startMs: 0, endMs: 1200, tokensUsed: 512 },
        'node-b': { startMs: 1200, endMs: 3200, tokensUsed: 1536 },
      },
      discoveryResults: {
        'node-a': { query: 'search tools', toolsFound: ['web_search', 'file_search'], latencyMs: 45 },
      },
      guardrailResults: {
        'grounding-guard': { guardrailId: 'grounding-guard', passed: true, action: 'none', latencyMs: 8 },
      },
      checkpointsSaved: 2,
      memoryReads: 4,
      memoryWrites: 2,
    };
    expect(view.totalTokensUsed).toBe(2048);
    expect(Object.keys(view.nodeTimings)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// GraphNode
// ---------------------------------------------------------------------------

describe('GraphNode', () => {
  it('constructs a gmi node with all optional policies', () => {
    const node: GraphNode = {
      id: 'reasoning-node',
      type: 'gmi',
      executorConfig: {
        type: 'gmi',
        instructions: 'Reason step by step.',
        maxInternalIterations: 8,
        parallelTools: false,
        temperature: 0.3,
      },
      executionMode: 'react_bounded',
      effectClass: 'read',
      timeout: 30_000,
      retryPolicy: { maxAttempts: 2, backoff: 'linear', backoffMs: 1000 },
      checkpoint: 'after',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      outputSchema: { type: 'object', properties: { answer: { type: 'string' } } },
      memoryPolicy: { consistency: 'live' },
      discoveryPolicy: { enabled: true, query: 'reasoning tools', kind: 'any', maxResults: 3 },
      personaPolicy: { traits: { conscientiousness: 0.8 }, adaptStyle: true },
      guardrailPolicy: { output: ['toxicity-filter'], onViolation: 'warn' },
    };
    expect(node.id).toBe('reasoning-node');
    expect(node.type).toBe('gmi');
    expect(node.checkpoint).toBe('after');
    expect(node.executionMode).toBe('react_bounded');
  });

  it('constructs a router node (minimal)', () => {
    const node: GraphNode = {
      id: 'intent-router',
      type: 'router',
      executorConfig: {
        type: 'router',
        condition: { type: 'expression', expr: "state.scratch.intent" },
      },
      executionMode: 'single_turn',
      effectClass: 'pure',
      checkpoint: 'none',
    };
    expect(node.effectClass).toBe('pure');
    expect(node.checkpoint).toBe('none');
  });

  it('constructs a human node', () => {
    const node: GraphNode = {
      id: 'approval-gate',
      type: 'human',
      executorConfig: { type: 'human', prompt: 'Approve the action?' },
      executionMode: 'single_turn',
      effectClass: 'human',
      checkpoint: 'before',
    };
    expect(node.effectClass).toBe('human');
  });
});

// ---------------------------------------------------------------------------
// GraphEdge
// ---------------------------------------------------------------------------

describe('GraphEdge', () => {
  it('constructs a static edge from START', () => {
    const edge: GraphEdge = {
      id: 'entry-edge',
      source: START,
      target: 'first-node',
      type: 'static',
    };
    expect(edge.source).toBe(START);
  });

  it('constructs a conditional edge to END', () => {
    const edge: GraphEdge = {
      id: 'exit-edge',
      source: 'last-node',
      target: END,
      type: 'conditional',
      condition: { type: 'expression', expr: "state.scratch.done === true ? '__END__' : 'retry-node'" },
    };
    expect(edge.target).toBe(END);
    expect(edge.condition?.type).toBe('expression');
  });

  it('constructs a discovery edge', () => {
    const edge: GraphEdge = {
      id: 'discover-edge',
      source: 'planner-node',
      target: 'tool-node', // runtime may override
      type: 'discovery',
      discoveryQuery: 'file management',
      discoveryKind: 'tool',
      discoveryFallback: 'generic-tool-node',
    };
    expect(edge.type).toBe('discovery');
    expect(edge.discoveryFallback).toBe('generic-tool-node');
  });

  it('constructs a personality edge', () => {
    const edge: GraphEdge = {
      id: 'personality-edge',
      source: 'response-generator',
      target: 'verbose-node',
      type: 'personality',
      personalityCondition: {
        trait: 'openness',
        threshold: 0.6,
        above: 'creative-node',
        below: 'structured-node',
      },
    };
    expect(edge.type).toBe('personality');
    expect(edge.personalityCondition?.threshold).toBe(0.6);
  });
});

// ---------------------------------------------------------------------------
// GraphState
// ---------------------------------------------------------------------------

describe('GraphState', () => {
  it('constructs a typed GraphState', () => {
    type Input = { userMessage: string };
    type Scratch = { intent: string; confidence: number };
    type Artifacts = { reply: string };

    const emptyMemoryView: MemoryView = {
      traces: [],
      pendingWrites: [],
      totalTracesRead: 0,
      readLatencyMs: 0,
    };

    const emptyDiagnostics: DiagnosticsView = {
      totalTokensUsed: 0,
      totalDurationMs: 0,
      nodeTimings: {},
      discoveryResults: {},
      guardrailResults: {},
      checkpointsSaved: 0,
      memoryReads: 0,
      memoryWrites: 0,
    };

    const state: GraphState<Input, Scratch, Artifacts> = {
      input: { userMessage: 'Hello!' },
      scratch: { intent: 'greeting', confidence: 0.97 },
      memory: emptyMemoryView,
      artifacts: { reply: 'Hi there!' },
      diagnostics: emptyDiagnostics,
      currentNodeId: 'greeting-node',
      visitedNodes: ['greeting-node'],
      iteration: 0,
      checkpointId: 'cp-abc-123',
    };

    expect(state.input.userMessage).toBe('Hello!');
    expect(state.scratch.confidence).toBeCloseTo(0.97);
    expect(state.visitedNodes).toHaveLength(1);
    expect(state.checkpointId).toBe('cp-abc-123');
  });
});

// ---------------------------------------------------------------------------
// StateReducers
// ---------------------------------------------------------------------------

describe('StateReducers', () => {
  it('accepts builtin reducer names', () => {
    const reducers: StateReducers = {
      'scratch.messages': 'concat',
      'scratch.score': 'max',
      'artifacts.summary': 'last',
    };
    expect(reducers['scratch.messages']).toBe('concat');
  });

  it('accepts custom reducer functions', () => {
    const customReducer: ReducerFn = (existing, incoming) =>
      `${String(existing)} ${String(incoming)}`.trim();
    const reducers: StateReducers = { 'scratch.narrative': customReducer };
    const combined = (reducers['scratch.narrative'] as ReducerFn)('Hello', 'World');
    expect(combined).toBe('Hello World');
  });

  it('accepts all builtin reducer values', () => {
    const builtins: BuiltinReducer[] = ['concat', 'merge', 'max', 'min', 'avg', 'sum', 'last', 'first', 'longest'];
    const reducers: StateReducers = Object.fromEntries(builtins.map((b) => [`field.${b}`, b]));
    expect(Object.keys(reducers)).toHaveLength(9);
  });
});

// ---------------------------------------------------------------------------
// CheckpointMetadata
// ---------------------------------------------------------------------------

describe('CheckpointMetadata', () => {
  it('constructs a valid checkpoint descriptor', () => {
    const meta: CheckpointMetadata = {
      id: 'cp-uuid-0001',
      runId: 'run-uuid-0001',
      graphId: 'my-agent-graph',
      nodeId: 'reasoning-node',
      timestamp: 1_700_000_000_000,
      stateSize: 4096,
      hasMemorySnapshot: true,
    };
    expect(meta.hasMemorySnapshot).toBe(true);
    expect(meta.stateSize).toBe(4096);
  });
});

// ---------------------------------------------------------------------------
// RunInspection
// ---------------------------------------------------------------------------

describe('RunInspection', () => {
  it('constructs a running inspection', () => {
    const inspection: RunInspection = {
      runId: 'run-001',
      graphId: 'graph-001',
      status: 'running',
      currentNodeId: 'node-b',
      visitedNodes: ['node-a'],
      events: [],
      checkpoints: [],
      diagnostics: {
        totalTokensUsed: 256,
        totalDurationMs: 800,
        nodeTimings: {},
        discoveryResults: {},
        guardrailResults: {},
        checkpointsSaved: 0,
        memoryReads: 1,
        memoryWrites: 0,
      },
    };
    expect(inspection.status).toBe('running');
    expect(inspection.finalOutput).toBeUndefined();
  });

  it('constructs a completed inspection with output', () => {
    const inspection: RunInspection = {
      runId: 'run-002',
      graphId: 'graph-001',
      status: 'completed',
      visitedNodes: ['node-a', 'node-b'],
      events: [],
      checkpoints: [],
      diagnostics: {
        totalTokensUsed: 1024,
        totalDurationMs: 2500,
        nodeTimings: {},
        discoveryResults: {},
        guardrailResults: {},
        checkpointsSaved: 1,
        memoryReads: 2,
        memoryWrites: 1,
      },
      finalOutput: { answer: '42' },
    };
    expect(inspection.finalOutput).toEqual({ answer: '42' });
  });

  it('constructs an errored inspection', () => {
    const inspection: RunInspection = {
      runId: 'run-003',
      graphId: 'graph-001',
      status: 'errored',
      visitedNodes: ['node-a'],
      events: [],
      checkpoints: [],
      diagnostics: {
        totalTokensUsed: 128,
        totalDurationMs: 500,
        nodeTimings: {},
        discoveryResults: {},
        guardrailResults: {},
        checkpointsSaved: 0,
        memoryReads: 0,
        memoryWrites: 0,
      },
      error: { message: 'Tool not found', code: 'TOOL_NOT_FOUND', nodeId: 'node-a' },
    };
    expect(inspection.error?.code).toBe('TOOL_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// CompiledExecutionGraph — root IR type
// ---------------------------------------------------------------------------

describe('CompiledExecutionGraph', () => {
  it('constructs a minimal valid graph', () => {
    const graph: CompiledExecutionGraph = {
      id: 'echo-graph',
      name: 'Echo Agent',
      nodes: [
        {
          id: 'echo-node',
          type: 'gmi',
          executorConfig: { type: 'gmi', instructions: 'Repeat the user input verbatim.' },
          executionMode: 'single_turn',
          effectClass: 'pure',
          checkpoint: 'none',
        },
      ],
      edges: [
        { id: 'e1', source: START, target: 'echo-node', type: 'static' },
        { id: 'e2', source: 'echo-node', target: END, type: 'static' },
      ],
      stateSchema: {
        input: { type: 'object', properties: { message: { type: 'string' } } },
        scratch: {},
        artifacts: { type: 'object', properties: { echo: { type: 'string' } } },
      },
      reducers: { 'artifacts.echo': 'last' },
      checkpointPolicy: 'none',
      memoryConsistency: 'live',
    };

    expect(graph.id).toBe('echo-graph');
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges[0].source).toBe(START);
    expect(graph.edges[1].target).toBe(END);
    expect(graph.checkpointPolicy).toBe('none');
    expect(graph.memoryConsistency).toBe('live');
  });

  it('constructs a multi-node graph with reducers and policies', () => {
    const graph: CompiledExecutionGraph = {
      id: 'research-graph',
      name: 'Research Agent',
      nodes: [
        {
          id: 'search-node',
          type: 'tool',
          executorConfig: { type: 'tool', toolName: 'web_search', args: { maxResults: 5 } },
          executionMode: 'single_turn',
          effectClass: 'external',
          checkpoint: 'after',
          retryPolicy: { maxAttempts: 3, backoff: 'exponential', backoffMs: 500 },
        },
        {
          id: 'summarise-node',
          type: 'gmi',
          executorConfig: { type: 'gmi', instructions: 'Summarise the search results.', temperature: 0.5 },
          executionMode: 'single_turn',
          effectClass: 'pure',
          checkpoint: 'both',
          memoryPolicy: { consistency: 'journaled', write: { autoEncode: true, type: 'semantic', scope: 'session' } },
        },
        {
          id: 'guardrail-node',
          type: 'guardrail',
          executorConfig: { type: 'guardrail', guardrailIds: ['pii-filter'], onViolation: 'sanitize' },
          executionMode: 'single_turn',
          effectClass: 'pure',
          checkpoint: 'none',
        },
      ],
      edges: [
        { id: 'e1', source: START, target: 'search-node', type: 'static' },
        { id: 'e2', source: 'search-node', target: 'summarise-node', type: 'static' },
        { id: 'e3', source: 'summarise-node', target: 'guardrail-node', type: 'static' },
        { id: 'e4', source: 'guardrail-node', target: END, type: 'static' },
      ],
      stateSchema: {
        input: { type: 'object' },
        scratch: { type: 'object' },
        artifacts: { type: 'object' },
      },
      reducers: {
        'scratch.searchResults': 'concat',
        'artifacts.summary': 'last',
      },
      checkpointPolicy: 'explicit',
      memoryConsistency: 'journaled',
    };

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(4);
    expect(graph.checkpointPolicy).toBe('explicit');
    expect(graph.reducers['scratch.searchResults']).toBe('concat');
    // Verify node ids form a valid chain
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    for (const edge of graph.edges) {
      if (edge.source !== START) expect(nodeIds.has(edge.source)).toBe(true);
      if (edge.target !== END) expect(nodeIds.has(edge.target)).toBe(true);
    }
  });
});
