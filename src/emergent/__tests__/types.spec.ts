import { describe, it, expect } from 'vitest';
import type {
  ToolTier,
  SandboxAPI,
  EmergentTool,
  ForgeToolRequest,
  ForgeTestCase,
  CreationVerdict,
  PromotionVerdict,
  ReuseVerdict,
  ComposableStep,
  ComposableToolSpec,
  SandboxedToolSpec,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  ToolUsageStats,
  ForgeResult,
  PromotionResult,
  EmergentConfig,
} from '../types.js';
import { DEFAULT_EMERGENT_CONFIG } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers — builds valid objects without relying on runtime constructors
// ---------------------------------------------------------------------------

function makeUsageStats(overrides: Partial<ToolUsageStats> = {}): ToolUsageStats {
  return {
    totalUses: 0,
    successCount: 0,
    failureCount: 0,
    avgExecutionTimeMs: 0,
    lastUsedAt: null,
    confidenceScore: 0,
    ...overrides,
  };
}

function makeCreationVerdict(overrides: Partial<CreationVerdict> = {}): CreationVerdict {
  return {
    approved: true,
    confidence: 0.9,
    safety: 0.95,
    correctness: 0.85,
    determinism: 0.9,
    bounded: 0.92,
    reasoning: 'All test cases passed.',
    ...overrides,
  };
}

function makeSandboxSpec(): SandboxedToolSpec {
  return {
    mode: 'sandbox',
    code: 'async function run(input) { return { result: input.value * 2 }; }',
    allowlist: ['crypto'],
  };
}

function makeEmergentTool(overrides: Partial<EmergentTool> = {}): EmergentTool {
  return {
    id: 'emergent:test-uuid-1234',
    name: 'double_value',
    description: 'Returns double the input value.',
    inputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
    outputSchema: { type: 'object', properties: { result: { type: 'number' } } },
    implementation: makeSandboxSpec(),
    tier: 'session',
    createdBy: 'agent-gmi-42',
    createdAt: '2026-01-01T00:00:00.000Z',
    judgeVerdicts: [makeCreationVerdict()],
    usageStats: makeUsageStats(),
    source: 'forged by agent gmi-42 during session sess-99',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('emergent/types', () => {
  // -------------------------------------------------------------------------
  // 1. ToolTier has three valid values
  // -------------------------------------------------------------------------
  describe('ToolTier', () => {
    it('accepts all three valid tier values', () => {
      const tiers: ToolTier[] = ['session', 'agent', 'shared'];
      expect(tiers).toHaveLength(3);
      expect(tiers).toContain('session');
      expect(tiers).toContain('agent');
      expect(tiers).toContain('shared');
    });

    it('session is the lowest scope tier', () => {
      const ordered: ToolTier[] = ['session', 'agent', 'shared'];
      expect(ordered[0]).toBe('session');
    });

    it('shared is the broadest scope tier', () => {
      const ordered: ToolTier[] = ['session', 'agent', 'shared'];
      expect(ordered[ordered.length - 1]).toBe('shared');
    });
  });

  // -------------------------------------------------------------------------
  // 2. SandboxAPI has three valid values
  // -------------------------------------------------------------------------
  describe('SandboxAPI', () => {
    it('accepts all three sandbox API identifiers', () => {
      const apis: SandboxAPI[] = ['fetch', 'fs.readFile', 'crypto'];
      expect(apis).toHaveLength(3);
      expect(apis).toContain('fetch');
      expect(apis).toContain('fs.readFile');
      expect(apis).toContain('crypto');
    });

    it('sandboxed spec with full allowlist is valid', () => {
      const spec: SandboxedToolSpec = {
        mode: 'sandbox',
        code: 'async function run(input) { return {}; }',
        allowlist: ['fetch', 'fs.readFile', 'crypto'],
      };
      expect(spec.allowlist).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // 3. EmergentTool can be constructed with all required fields
  // -------------------------------------------------------------------------
  describe('EmergentTool', () => {
    it('can be constructed with a sandboxed implementation', () => {
      const tool = makeEmergentTool();
      expect(tool.id).toBe('emergent:test-uuid-1234');
      expect(tool.name).toBe('double_value');
      expect(tool.tier).toBe('session');
      expect(tool.implementation.mode).toBe('sandbox');
    });

    it('can be constructed with a composable implementation', () => {
      const step: ComposableStep = {
        name: 'search',
        tool: 'web_search',
        inputMapping: { query: '$input.term' },
        condition: '$input.term !== ""',
      };
      const spec: ComposableToolSpec = { mode: 'compose', steps: [step] };
      const tool = makeEmergentTool({ implementation: spec });
      expect(tool.implementation.mode).toBe('compose');
      const impl = tool.implementation as ComposableToolSpec;
      expect(impl.steps).toHaveLength(1);
      expect(impl.steps[0].name).toBe('search');
    });

    it('stores multiple judge verdicts in order', () => {
      const v1 = makeCreationVerdict({ confidence: 0.7 });
      const v2 = makeCreationVerdict({ confidence: 0.95 });
      const tool = makeEmergentTool({ judgeVerdicts: [v1, v2] });
      expect(tool.judgeVerdicts).toHaveLength(2);
      expect((tool.judgeVerdicts[0] as CreationVerdict).confidence).toBe(0.7);
      expect((tool.judgeVerdicts[1] as CreationVerdict).confidence).toBe(0.95);
    });

    it('tracks usage stats with all required fields', () => {
      const stats = makeUsageStats({ totalUses: 10, successCount: 9, failureCount: 1 });
      const tool = makeEmergentTool({ usageStats: stats });
      expect(tool.usageStats.totalUses).toBe(10);
      expect(tool.usageStats.successCount).toBe(9);
      expect(tool.usageStats.failureCount).toBe(1);
      expect(tool.usageStats.lastUsedAt).toBeNull();
    });

    it('accepts all three tier values', () => {
      const tiers: ToolTier[] = ['session', 'agent', 'shared'];
      for (const tier of tiers) {
        const tool = makeEmergentTool({ tier });
        expect(tool.tier).toBe(tier);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. ForgeToolRequest requires testCases
  // -------------------------------------------------------------------------
  describe('ForgeToolRequest', () => {
    it('accepts a request with one test case', () => {
      const testCase: ForgeTestCase = {
        input: { value: 4 },
        expectedOutput: { result: 8 },
      };
      const req: ForgeToolRequest = {
        name: 'double_value',
        description: 'Returns double the input value.',
        inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
        outputSchema: { type: 'object', properties: { result: { type: 'number' } } },
        implementation: makeSandboxSpec(),
        testCases: [testCase],
      };
      expect(req.testCases).toHaveLength(1);
      expect(req.testCases[0].input).toEqual({ value: 4 });
      expect(req.testCases[0].expectedOutput).toEqual({ result: 8 });
    });

    it('accepts a request with multiple test cases', () => {
      const cases: [ForgeTestCase, ...ForgeTestCase[]] = [
        { input: { value: 2 }, expectedOutput: { result: 4 } },
        { input: { value: 0 }, expectedOutput: { result: 0 } },
        { input: { value: -1 }, expectedOutput: { result: -2 } },
      ];
      const req: ForgeToolRequest = {
        name: 'double_value',
        description: 'Returns double the input value.',
        inputSchema: {},
        outputSchema: {},
        implementation: makeSandboxSpec(),
        testCases: cases,
      };
      expect(req.testCases).toHaveLength(3);
    });

    it('ForgeResult captures tool and verdict on success', () => {
      const result: ForgeResult = {
        success: true,
        toolId: 'emergent:abc',
        tool: makeEmergentTool({ id: 'emergent:abc' }),
        verdict: makeCreationVerdict(),
      };
      expect(result.success).toBe(true);
      expect(result.toolId).toBe('emergent:abc');
      expect(result.verdict?.approved).toBe(true);
    });

    it('ForgeResult captures error on failure', () => {
      const result: ForgeResult = {
        success: false,
        verdict: makeCreationVerdict({ approved: false, reasoning: 'Safety score too low.' }),
        error: undefined,
      };
      expect(result.success).toBe(false);
      expect(result.verdict?.approved).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 5. CreationVerdict has all evaluation dimensions
  // -------------------------------------------------------------------------
  describe('CreationVerdict', () => {
    it('contains all five evaluation dimension scores', () => {
      const verdict = makeCreationVerdict();
      // Confirm all dimensions are present and numeric
      expect(typeof verdict.safety).toBe('number');
      expect(typeof verdict.correctness).toBe('number');
      expect(typeof verdict.determinism).toBe('number');
      expect(typeof verdict.bounded).toBe('number');
      expect(typeof verdict.confidence).toBe('number');
    });

    it('has an approved boolean flag', () => {
      const approved = makeCreationVerdict({ approved: true });
      const rejected = makeCreationVerdict({ approved: false });
      expect(approved.approved).toBe(true);
      expect(rejected.approved).toBe(false);
    });

    it('has a reasoning string', () => {
      const verdict = makeCreationVerdict({ reasoning: 'Test output matched expected.' });
      expect(typeof verdict.reasoning).toBe('string');
      expect(verdict.reasoning.length).toBeGreaterThan(0);
    });

    it('scores are in [0, 1] range', () => {
      const verdict = makeCreationVerdict();
      for (const key of ['safety', 'correctness', 'determinism', 'bounded', 'confidence'] as const) {
        expect(verdict[key]).toBeGreaterThanOrEqual(0);
        expect(verdict[key]).toBeLessThanOrEqual(1);
      }
    });

    it('PromotionVerdict requires both sub-reviewer verdicts', () => {
      const promotion: PromotionVerdict = {
        approved: true,
        safetyAuditor: { approved: true, confidence: 0.95, reasoning: 'No unsafe patterns found.' },
        correctnessReviewer: { approved: true, confidence: 0.88, reasoning: 'All test cases pass.' },
        confidence: 0.91,
      };
      expect(promotion.safetyAuditor.approved).toBe(true);
      expect(promotion.correctnessReviewer.approved).toBe(true);
      expect(promotion.confidence).toBe(0.91);
    });

    it('PromotionResult captures error on system failure', () => {
      const result: PromotionResult = {
        success: false,
        error: 'Judge model unavailable.',
      };
      expect(result.success).toBe(false);
      expect(result.error).toBe('Judge model unavailable.');
    });

    it('ReuseVerdict flags anomalies with a reason', () => {
      const reuse: ReuseVerdict = {
        valid: false,
        schemaErrors: ['inputSchema: missing required property "value"'],
        anomaly: true,
        anomalyReason: 'Output distribution shifted significantly from baseline.',
      };
      expect(reuse.valid).toBe(false);
      expect(reuse.schemaErrors).toHaveLength(1);
      expect(reuse.anomaly).toBe(true);
      expect(reuse.anomalyReason).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // 6. DEFAULT_EMERGENT_CONFIG has correct defaults
  // -------------------------------------------------------------------------
  describe('DEFAULT_EMERGENT_CONFIG', () => {
    it('is disabled by default', () => {
      expect(DEFAULT_EMERGENT_CONFIG.enabled).toBe(false);
    });

    it('has correct session tool limit', () => {
      expect(DEFAULT_EMERGENT_CONFIG.maxSessionTools).toBe(10);
    });

    it('has correct agent tool limit', () => {
      expect(DEFAULT_EMERGENT_CONFIG.maxAgentTools).toBe(50);
    });

    it('has correct sandbox memory limit', () => {
      expect(DEFAULT_EMERGENT_CONFIG.sandboxMemoryMB).toBe(128);
    });

    it('has correct sandbox timeout', () => {
      expect(DEFAULT_EMERGENT_CONFIG.sandboxTimeoutMs).toBe(5000);
    });

    it('has correct promotion threshold defaults', () => {
      expect(DEFAULT_EMERGENT_CONFIG.promotionThreshold.uses).toBe(5);
      expect(DEFAULT_EMERGENT_CONFIG.promotionThreshold.confidence).toBe(0.8);
    });

    it('uses gpt-4o-mini as judge model', () => {
      expect(DEFAULT_EMERGENT_CONFIG.judgeModel).toBe('gpt-4o-mini');
    });

    it('uses gpt-4o as promotion judge model', () => {
      expect(DEFAULT_EMERGENT_CONFIG.promotionJudgeModel).toBe('gpt-4o');
    });

    it('sandbox execution request shape is valid with defaults', () => {
      const req: SandboxExecutionRequest = {
        code: 'async function run(input) { return input; }',
        input: { x: 1 },
        allowlist: [],
        memoryMB: DEFAULT_EMERGENT_CONFIG.sandboxMemoryMB,
        timeoutMs: DEFAULT_EMERGENT_CONFIG.sandboxTimeoutMs,
      };
      expect(req.memoryMB).toBe(128);
      expect(req.timeoutMs).toBe(5000);
    });

    it('sandbox execution result shape is valid', () => {
      const result: SandboxExecutionResult = {
        success: true,
        output: { doubled: 4 },
        executionTimeMs: 42,
        memoryUsedBytes: 1024 * 1024,
      };
      expect(result.success).toBe(true);
      expect(result.executionTimeMs).toBe(42);
    });

    it('config can be extended with custom values', () => {
      const custom: EmergentConfig = {
        ...DEFAULT_EMERGENT_CONFIG,
        enabled: true,
        maxSessionTools: 25,
      };
      expect(custom.enabled).toBe(true);
      expect(custom.maxSessionTools).toBe(25);
      // Unchanged values remain
      expect(custom.judgeModel).toBe('gpt-4o-mini');
    });
  });
});
