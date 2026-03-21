/**
 * @file CodeSafetyScanner.spec.ts
 * @description Unit tests for {@link CodeSafetyScanner}.
 *
 * Test strategy:
 * - `scan()`: happy path with violations, clean code, multiple blocks, no blocks.
 * - `scanBlock()`: language-aware matching, severity ordering, safe block.
 * - `scanCode()`: explicit language hint, null language auto-detect.
 * - Custom rules override / extend the default set.
 * - Summary string contains severity breakdowns and BLOCKED/FLAGGED status.
 * - Violations are sorted by severity (critical before high before medium before low).
 */

import { describe, it, expect } from 'vitest';
import { CodeSafetyScanner } from '../../../../src/extensions/packs/code-safety/CodeSafetyScanner';
import { DEFAULT_RULES } from '../../../../src/extensions/packs/code-safety/DefaultRules';
import type { ICodeSafetyRule } from '../../../../src/extensions/packs/code-safety/types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * A minimal custom rule used in custom-rule tests so we don't need to rely on
 * specific DEFAULT_RULES IDs.
 */
const CUSTOM_RULE: ICodeSafetyRule = {
  id: 'test-custom-rule',
  name: 'Test custom rule',
  description: 'Matches the literal string UNSAFE_MARKER for testing purposes.',
  category: 'other',
  severity: 'high',
  patterns: {
    '*': [/UNSAFE_MARKER/],
  },
};

/**
 * A critical-severity custom rule (to test blocker path in custom-rules mode).
 */
const CRITICAL_CUSTOM_RULE: ICodeSafetyRule = {
  id: 'test-critical-rule',
  name: 'Test critical rule',
  description: 'Matches CRITICAL_MARKER.',
  category: 'other',
  severity: 'critical',
  patterns: {
    '*': [/CRITICAL_MARKER/],
  },
};

/**
 * A low-severity custom rule (should be flagged, not blocked by default).
 */
const LOW_CUSTOM_RULE: ICodeSafetyRule = {
  id: 'test-low-rule',
  name: 'Test low rule',
  description: 'Matches LOW_MARKER.',
  category: 'other',
  severity: 'low',
  patterns: {
    '*': [/LOW_MARKER/],
  },
};

// ---------------------------------------------------------------------------
// scan() — primary API
// ---------------------------------------------------------------------------

describe('CodeSafetyScanner.scan()', () => {
  describe('detects violations in a Python code block', () => {
    it('eval in Python code block → critical violation', () => {
      const scanner = new CodeSafetyScanner();
      const text = '```python\nresult = eval(user_input)\n```';
      const result = scanner.scan(text);

      expect(result.safe).toBe(false);
      expect(result.blocksScanned).toBe(1);
      expect(result.violations.length).toBeGreaterThan(0);

      // The first violation should be critical (eval is critical)
      expect(result.violations[0].severity).toBe('critical');
      expect(result.violations[0].ruleId).toBe('code-injection-eval');
    });

    it('pickle.loads in Python block → critical violation', () => {
      const scanner = new CodeSafetyScanner();
      const text = '```python\nimport pickle\nobj = pickle.loads(data)\n```';
      const result = scanner.scan(text);

      expect(result.safe).toBe(false);
      const pickleViolation = result.violations.find((v) => v.ruleId === 'insecure-pickle');
      expect(pickleViolation).toBeDefined();
      expect(pickleViolation!.severity).toBe('critical');
      expect(pickleViolation!.action).toBe('block');
    });
  });

  describe('clean code → safe result', () => {
    it('plain safe Python code produces no violations', () => {
      const scanner = new CodeSafetyScanner();
      const text = '```python\ndef greet(name):\n    return f"Hello, {name}!"\n```';
      const result = scanner.scan(text);

      expect(result.safe).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.blocksScanned).toBe(1);
    });

    it('plain prose text (no code blocks) is safe', () => {
      const scanner = new CodeSafetyScanner();
      const result = scanner.scan('This is just regular text with no code fences.');

      expect(result.safe).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.blocksScanned).toBe(0);
    });
  });

  describe('no code blocks', () => {
    it('empty string → safe, blocksScanned = 0', () => {
      const scanner = new CodeSafetyScanner();
      const result = scanner.scan('');

      expect(result.safe).toBe(true);
      expect(result.blocksScanned).toBe(0);
      expect(result.violations).toHaveLength(0);
    });

    it('plain text with no fences → safe, blocksScanned = 0', () => {
      const scanner = new CodeSafetyScanner();
      const result = scanner.scan('No code here, just words.');

      expect(result.safe).toBe(true);
      expect(result.blocksScanned).toBe(0);
    });
  });

  describe('multiple code blocks', () => {
    it('collects violations from all blocks', () => {
      const scanner = new CodeSafetyScanner();
      const text = [
        '```python',
        'eval(user_code)',                     // injection violation
        '```',
        '',
        '```python',
        'pickle.loads(data)',                  // deserialization violation
        '```',
      ].join('\n');

      const result = scanner.scan(text);

      expect(result.blocksScanned).toBe(2);
      expect(result.safe).toBe(false);
      // Both blocks have violations
      const ruleIds = result.violations.map((v) => v.ruleId);
      expect(ruleIds).toContain('code-injection-eval');
      expect(ruleIds).toContain('insecure-pickle');
    });

    it('correctly counts scanned blocks when all are clean', () => {
      const scanner = new CodeSafetyScanner();
      const text = [
        '```python',
        'x = 1 + 1',
        '```',
        '',
        '```javascript',
        'const y = 2 * 3;',
        '```',
      ].join('\n');

      const result = scanner.scan(text);

      expect(result.blocksScanned).toBe(2);
      expect(result.safe).toBe(true);
    });
  });

  describe('violations sorted by severity', () => {
    it('critical violations appear before high before medium before low', () => {
      // Use custom rules with different severity levels to test ordering
      const rules: ICodeSafetyRule[] = [
        { ...LOW_CUSTOM_RULE, id: 'low-rule', patterns: { '*': [/LOW_MARKER/] } },
        { ...CRITICAL_CUSTOM_RULE, id: 'critical-rule', patterns: { '*': [/CRITICAL_MARKER/] } },
        {
          id: 'medium-rule',
          name: 'Medium',
          description: 'medium',
          category: 'other',
          severity: 'medium',
          patterns: { '*': [/MEDIUM_MARKER/] },
        },
      ];
      const scanner = new CodeSafetyScanner(rules);
      // All three markers in one block
      const text = '```\nLOW_MARKER CRITICAL_MARKER MEDIUM_MARKER\n```';

      const result = scanner.scan(text);

      expect(result.violations).toHaveLength(3);
      expect(result.violations[0].severity).toBe('critical');
      expect(result.violations[1].severity).toBe('medium');
      expect(result.violations[2].severity).toBe('low');
    });
  });
});

// ---------------------------------------------------------------------------
// scanCode() — convenience wrapper
// ---------------------------------------------------------------------------

describe('CodeSafetyScanner.scanCode()', () => {
  it('detects eval violation with explicit language null', () => {
    const scanner = new CodeSafetyScanner();
    const violations = scanner.scanCode('eval(user_input)', null);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].ruleId).toBe('code-injection-eval');
    expect(violations[0].severity).toBe('critical');
  });

  it('detects SQL injection with explicit sql language', () => {
    const scanner = new CodeSafetyScanner();
    const violations = scanner.scanCode("SELECT * FROM users WHERE name = '' OR 1=1", 'sql');

    const sqliViolation = violations.find((v) => v.ruleId === 'sql-injection-keywords');
    expect(sqliViolation).toBeDefined();
  });

  it('detects pickle with explicit python language', () => {
    const scanner = new CodeSafetyScanner();
    const violations = scanner.scanCode('obj = pickle.loads(payload)', 'python');

    expect(violations.some((v) => v.ruleId === 'insecure-pickle')).toBe(true);
  });

  it('returns empty array for safe code', () => {
    const scanner = new CodeSafetyScanner();
    const violations = scanner.scanCode('const x = 1 + 2;', 'javascript');

    expect(violations).toHaveLength(0);
  });

  it('stores the provided language on each violation', () => {
    const scanner = new CodeSafetyScanner();
    const violations = scanner.scanCode('eval(x)', 'javascript');

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].language).toBe('javascript');
  });

  it('auto-detects language when null is passed', () => {
    // Bash code — scanCode with null should still auto-detect and match patterns
    const scanner = new CodeSafetyScanner();
    const violations = scanner.scanCode('echo ../../../etc/passwd', null);

    // path-traversal rule has '*' patterns so it should fire regardless of language
    const traversalViolation = violations.find((v) => v.ruleId === 'path-traversal-dotdot');
    expect(traversalViolation).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Custom rules
// ---------------------------------------------------------------------------

describe('custom rules', () => {
  it('custom rules fire when their pattern is matched', () => {
    const scanner = new CodeSafetyScanner([CUSTOM_RULE]);
    const violations = scanner.scanCode('UNSAFE_MARKER here', null);

    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe('test-custom-rule');
  });

  it('custom rules do NOT fire when pattern is not matched', () => {
    const scanner = new CodeSafetyScanner([CUSTOM_RULE]);
    const violations = scanner.scanCode('this is safe code', null);

    expect(violations).toHaveLength(0);
  });

  it('custom critical rule blocks (via default severity action)', () => {
    const scanner = new CodeSafetyScanner([CRITICAL_CUSTOM_RULE]);
    const result = scanner.scan('```\nCRITICAL_MARKER\n```');

    expect(result.safe).toBe(false);
    expect(result.violations[0].action).toBe('block');
  });

  it('custom low rule flags but does not block by default', () => {
    const scanner = new CodeSafetyScanner([LOW_CUSTOM_RULE]);
    const result = scanner.scan('```\nLOW_MARKER\n```');

    // Low severity → flagged, not blocked
    expect(result.violations[0].action).toBe('flag');
    // Safe is true when only flagged violations exist
    expect(result.safe).toBe(true);
  });

  it('severity action overrides work', () => {
    // Override: medium should now block
    const scanner = new CodeSafetyScanner(
      [
        {
          id: 'medium-marker',
          name: 'Medium marker',
          description: 'test',
          category: 'other',
          severity: 'medium',
          patterns: { '*': [/MEDIUM_TEST/] },
        },
      ],
      { medium: 'block' },
    );

    const result = scanner.scan('```\nMEDIUM_TEST\n```');
    expect(result.violations[0].action).toBe('block');
    expect(result.safe).toBe(false);
  });

  it('mixed default + custom rules: both fire', () => {
    const scanner = new CodeSafetyScanner([...DEFAULT_RULES, CUSTOM_RULE]);
    // Code that triggers both eval (default) and UNSAFE_MARKER (custom)
    const violations = scanner.scanCode('eval(x); UNSAFE_MARKER', null);

    const ruleIds = violations.map((v) => v.ruleId);
    expect(ruleIds).toContain('code-injection-eval');
    expect(ruleIds).toContain('test-custom-rule');
  });
});

// ---------------------------------------------------------------------------
// Summary string
// ---------------------------------------------------------------------------

describe('scan result summary', () => {
  it('contains BLOCKED when a blocker violation is present', () => {
    const scanner = new CodeSafetyScanner();
    const result = scanner.scan('```python\neval(x)\n```');

    expect(result.summary).toContain('BLOCKED');
  });

  it('contains FLAGGED when only flagged violations are present', () => {
    const scanner = new CodeSafetyScanner([LOW_CUSTOM_RULE]);
    const result = scanner.scan('```\nLOW_MARKER\n```');

    expect(result.summary).toContain('FLAGGED');
  });

  it('contains severity counts in summary', () => {
    const scanner = new CodeSafetyScanner();
    const result = scanner.scan('```python\neval(x)\n```');

    // Critical violation → summary should mention critical
    expect(result.summary).toMatch(/critical/i);
  });

  it('reports "No code blocks found" when there are none', () => {
    const scanner = new CodeSafetyScanner();
    const result = scanner.scan('just plain text');

    expect(result.summary).toMatch(/no code blocks/i);
  });

  it('reports "No violations found" for clean code', () => {
    const scanner = new CodeSafetyScanner();
    const result = scanner.scan('```python\nx = 1 + 2\n```');

    expect(result.summary).toMatch(/no violations/i);
  });

  it('includes block count in summary', () => {
    const scanner = new CodeSafetyScanner();
    // Two blocks — both clean
    const text = '```python\nx = 1\n```\n\n```python\ny = 2\n```';
    const result = scanner.scan(text);

    // Should mention 2 blocks in the summary
    expect(result.summary).toContain('2');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('constructor with no arguments uses DEFAULT_RULES', () => {
    const scanner = new CodeSafetyScanner();
    // eval is in DEFAULT_RULES — should fire
    const violations = scanner.scanCode('eval(x)', null);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('scanner with empty rules array never fires', () => {
    const scanner = new CodeSafetyScanner([]);
    const violations = scanner.scanCode('eval(x) pickle.loads(d) DROP TABLE users', null);
    expect(violations).toHaveLength(0);
  });

  it('violation language field reflects detected (not just explicit) language', () => {
    const scanner = new CodeSafetyScanner();
    // No explicit language tag — block without tag uses auto-detect
    // Python with def keyword should auto-detect as python
    const text = '```\ndef foo():\n    eval(user)\n```';
    const result = scanner.scan(text);

    // There should be an eval violation
    const evalViolation = result.violations.find((v) => v.ruleId === 'code-injection-eval');
    expect(evalViolation).toBeDefined();
    // language should be auto-detected as python
    expect(evalViolation!.language).toBe('python');
  });
});
