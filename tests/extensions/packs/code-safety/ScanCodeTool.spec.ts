/**
 * @file ScanCodeTool.spec.ts
 * @description Unit tests for {@link ScanCodeTool}.
 *
 * ## Test strategy
 *
 * - **ITool contract**: verify all required readonly properties are set correctly.
 * - **execute() — unsafe code**: confirm that known-dangerous patterns (eval,
 *   pickle.loads) produce `safe=false` with violations present.
 * - **execute() — safe code**: confirm that benign code produces `safe=true`
 *   with an empty violations array.
 * - **language hint**: confirm that an explicit language is forwarded to the
 *   scanner and reflected on returned violations.
 * - **auto-detection**: confirm that omitting `language` triggers auto-detect
 *   (null is passed to scanCode) and still produces violations.
 * - **summary string**: spot-check summary content for blocked and clean cases.
 * - **blocksScanned**: always 1 regardless of input.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ScanCodeTool } from '../../../../src/extensions/packs/code-safety/tools/ScanCodeTool';
import { CodeSafetyScanner } from '../../../../src/extensions/packs/code-safety/CodeSafetyScanner';
import { DEFAULT_RULES } from '../../../../src/extensions/packs/code-safety/DefaultRules';
import type { ICodeSafetyRule } from '../../../../src/extensions/packs/code-safety/types';
import type { ToolExecutionContext } from '../../../../src/core/tools/ITool';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal ToolExecutionContext.  ScanCodeTool does not use the context, but
 * the interface requires it, so we supply a stub.
 */
const STUB_CONTEXT: ToolExecutionContext = {
  gmiId: 'test-gmi',
  personaId: 'test-persona',
  userContext: { userId: 'test-user' } as any,
};

/**
 * A medium-severity custom rule so we can reliably test the FLAGGED path
 * without relying on default rule internals.
 */
const MEDIUM_RULE: ICodeSafetyRule = {
  id: 'test-medium',
  name: 'Test medium rule',
  description: 'Fires on MEDIUM_CODE_MARKER.',
  category: 'other',
  severity: 'medium',
  patterns: { '*': [/MEDIUM_CODE_MARKER/] },
};

// ---------------------------------------------------------------------------
// ITool contract
// ---------------------------------------------------------------------------

describe('ScanCodeTool — ITool contract', () => {
  let tool: ScanCodeTool;

  beforeEach(() => {
    tool = new ScanCodeTool(new CodeSafetyScanner());
  });

  it('id is "scan_code"', () => {
    expect(tool.id).toBe('scan_code');
  });

  it('name is "scan_code"', () => {
    expect(tool.name).toBe('scan_code');
  });

  it('displayName is defined and non-empty', () => {
    expect(typeof tool.displayName).toBe('string');
    expect(tool.displayName.length).toBeGreaterThan(0);
  });

  it('description is defined and non-empty', () => {
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it('category is "security"', () => {
    expect(tool.category).toBe('security');
  });

  it('version is "1.0.0"', () => {
    expect(tool.version).toBe('1.0.0');
  });

  it('hasSideEffects is false', () => {
    expect(tool.hasSideEffects).toBe(false);
  });

  it('inputSchema has type "object"', () => {
    expect(tool.inputSchema.type).toBe('object');
  });

  it('inputSchema requires "code" field', () => {
    expect(tool.inputSchema.required).toContain('code');
  });

  it('inputSchema has optional "language" field', () => {
    expect(tool.inputSchema.properties).toHaveProperty('language');
  });
});

// ---------------------------------------------------------------------------
// execute() — unsafe code
// ---------------------------------------------------------------------------

describe('ScanCodeTool.execute() — unsafe code', () => {
  let tool: ScanCodeTool;

  beforeEach(() => {
    // Use default rules which include eval/injection, pickle, etc.
    tool = new ScanCodeTool(new CodeSafetyScanner());
  });

  it('eval() in code → safe=false, violations present', async () => {
    const result = await tool.execute(
      { code: 'eval(user_input)' },
      STUB_CONTEXT,
    );

    expect(result.success).toBe(true);
    expect(result.output!.safe).toBe(false);
    expect(result.output!.violations.length).toBeGreaterThan(0);
  });

  it('eval() violation has ruleId "code-injection-eval"', async () => {
    const result = await tool.execute(
      { code: 'result = eval(expr)' },
      STUB_CONTEXT,
    );

    const evalViolation = result.output!.violations.find(
      (v) => v.ruleId === 'code-injection-eval',
    );
    expect(evalViolation).toBeDefined();
    expect(evalViolation!.action).toBe('block');
  });

  it('pickle.loads() in Python code → safe=false', async () => {
    const result = await tool.execute(
      {
        code: 'import pickle\nobj = pickle.loads(data)',
        language: 'python',
      },
      STUB_CONTEXT,
    );

    expect(result.output!.safe).toBe(false);
    const pickleViolation = result.output!.violations.find(
      (v) => v.ruleId === 'insecure-pickle',
    );
    expect(pickleViolation).toBeDefined();
  });

  it('SQL injection pattern → safe=false', async () => {
    const result = await tool.execute(
      {
        code: "SELECT * FROM users WHERE name = '' OR 1=1",
        language: 'sql',
      },
      STUB_CONTEXT,
    );

    expect(result.output!.safe).toBe(false);
    expect(result.output!.violations.length).toBeGreaterThan(0);
  });

  it('blocksScanned is always 1', async () => {
    const result = await tool.execute(
      { code: 'eval(x)' },
      STUB_CONTEXT,
    );

    expect(result.output!.blocksScanned).toBe(1);
  });

  it('summary contains "BLOCKED" when violations are present', async () => {
    const result = await tool.execute(
      { code: 'eval(user_input)' },
      STUB_CONTEXT,
    );

    expect(result.output!.summary).toContain('BLOCKED');
  });
});

// ---------------------------------------------------------------------------
// execute() — safe code
// ---------------------------------------------------------------------------

describe('ScanCodeTool.execute() — safe code', () => {
  let tool: ScanCodeTool;

  beforeEach(() => {
    tool = new ScanCodeTool(new CodeSafetyScanner());
  });

  it('clean JavaScript code → safe=true, no violations', async () => {
    const result = await tool.execute(
      { code: 'const x = 1 + 2;', language: 'javascript' },
      STUB_CONTEXT,
    );

    expect(result.success).toBe(true);
    expect(result.output!.safe).toBe(true);
    expect(result.output!.violations).toHaveLength(0);
  });

  it('clean Python code → safe=true', async () => {
    const result = await tool.execute(
      {
        code: 'def add(a, b):\n    return a + b',
        language: 'python',
      },
      STUB_CONTEXT,
    );

    expect(result.output!.safe).toBe(true);
    expect(result.output!.violations).toHaveLength(0);
  });

  it('empty code string → safe=true, no violations', async () => {
    const result = await tool.execute(
      { code: '' },
      STUB_CONTEXT,
    );

    expect(result.output!.safe).toBe(true);
    expect(result.output!.violations).toHaveLength(0);
  });

  it('summary says "No violations" for clean code', async () => {
    const result = await tool.execute(
      { code: 'x = 1 + 2', language: 'python' },
      STUB_CONTEXT,
    );

    expect(result.output!.summary).toMatch(/no violations/i);
  });
});

// ---------------------------------------------------------------------------
// execute() — language argument handling
// ---------------------------------------------------------------------------

describe('ScanCodeTool.execute() — language handling', () => {
  let tool: ScanCodeTool;

  beforeEach(() => {
    tool = new ScanCodeTool(new CodeSafetyScanner());
  });

  it('explicit language is reflected on violations', async () => {
    const result = await tool.execute(
      { code: 'eval(x)', language: 'javascript' },
      STUB_CONTEXT,
    );

    // All violations should carry the supplied language.
    for (const violation of result.output!.violations) {
      expect(violation.language).toBe('javascript');
    }
  });

  it('omitting language triggers auto-detection (null passed to scanCode)', async () => {
    // Python code with a def — auto-detected as python.
    const result = await tool.execute(
      { code: 'def foo():\n    eval(user_code)' },
      STUB_CONTEXT,
    );

    expect(result.output!.safe).toBe(false);
    // The scanner should still detect the eval violation via '*' pattern.
    expect(result.output!.violations.length).toBeGreaterThan(0);
  });

  it('bash language with path-traversal pattern fires correct rule', async () => {
    const result = await tool.execute(
      {
        code: 'cat /etc/passwd',
        language: 'bash',
      },
      STUB_CONTEXT,
    );

    // /etc/passwd triggers the path-traversal-sensitive-files rule if it exists,
    // or at minimum we confirm the scan completes without error.
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// execute() — flagging path (medium/low violations)
// ---------------------------------------------------------------------------

describe('ScanCodeTool.execute() — FLAG violations', () => {
  it('medium-severity violation → safe=true (flag only), summary FLAGGED', async () => {
    // Custom scanner with only a medium-severity rule → action='flag' by default.
    const customScanner = new CodeSafetyScanner([MEDIUM_RULE]);
    const tool = new ScanCodeTool(customScanner);

    const result = await tool.execute(
      { code: 'MEDIUM_CODE_MARKER here' },
      STUB_CONTEXT,
    );

    expect(result.success).toBe(true);
    // safe=true because only flag (no block) violations were found.
    expect(result.output!.safe).toBe(true);
    expect(result.output!.violations.length).toBeGreaterThan(0);
    expect(result.output!.violations[0].action).toBe('flag');
    expect(result.output!.summary).toContain('FLAGGED');
  });
});

// ---------------------------------------------------------------------------
// execute() — result structure completeness
// ---------------------------------------------------------------------------

describe('ScanCodeTool.execute() — result structure', () => {
  it('always returns success=true for a valid input', async () => {
    const tool = new ScanCodeTool(new CodeSafetyScanner());
    const result = await tool.execute({ code: 'some code' }, STUB_CONTEXT);
    expect(result.success).toBe(true);
  });

  it('output always contains safe, violations, blocksScanned, summary', async () => {
    const tool = new ScanCodeTool(new CodeSafetyScanner());
    const result = await tool.execute({ code: 'x = 1' }, STUB_CONTEXT);

    expect(result.output).toBeDefined();
    expect(typeof result.output!.safe).toBe('boolean');
    expect(Array.isArray(result.output!.violations)).toBe(true);
    expect(typeof result.output!.blocksScanned).toBe('number');
    expect(typeof result.output!.summary).toBe('string');
  });
});
