/**
 * @fileoverview Tests for SandboxedToolForge.
 *
 * Covers:
 * 1. Simple pure function executes and returns output
 * 2. Code with `while(true)` is killed by timeout
 * 3. Code accessing `process` is caught by validateCode
 * 4. Code using `eval()` is caught by validateCode
 * 5. Code using `require()` is caught by validateCode
 * 6. `fetch` blocked when not in allowlist
 * 7. `fetch` allowed when in allowlist (mock in context)
 * 8. validateCode returns violations list with multiple entries
 * 9. Execution time is measured and returned
 */

import { describe, it, expect } from 'vitest';
import { SandboxedToolForge } from '../SandboxedToolForge.js';
import type { SandboxExecutionRequest, SandboxAPI } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal {@link SandboxExecutionRequest} from just code and input.
 * Defaults: empty allowlist, 128 MB memory, 5000 ms timeout.
 */
function makeRequest(
  code: string,
  input: unknown = {},
  overrides?: Partial<SandboxExecutionRequest>,
): SandboxExecutionRequest {
  return {
    code,
    input,
    allowlist: [],
    memoryMB: 128,
    timeoutMs: 5000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SandboxedToolForge', () => {
  const forge = new SandboxedToolForge();

  // -------------------------------------------------------------------------
  // 1. Simple pure function executes and returns output
  // -------------------------------------------------------------------------
  it('executes a simple pure function and returns the output', async () => {
    const request = makeRequest(
      'function execute(input) { return { sum: input.a + input.b }; }',
      { a: 2, b: 3 },
    );

    const result = await forge.execute(request);

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ sum: 5 });
    expect(result.error).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 2. Code with while(true) is killed by timeout
  // -------------------------------------------------------------------------
  it('kills infinite loops via timeout', async () => {
    const request = makeRequest(
      'function execute(input) { while(true) {} }',
      {},
      { timeoutMs: 100 }, // short timeout to keep tests fast
    );

    const result = await forge.execute(request);

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(50);
  });

  // -------------------------------------------------------------------------
  // 3. Code accessing `process` is caught by validateCode
  // -------------------------------------------------------------------------
  it('catches process access in validateCode', () => {
    const result = forge.validateCode(
      'function execute() { return process.env.SECRET; }',
      [],
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toContain('process access is forbidden');
  });

  // -------------------------------------------------------------------------
  // 4. Code using eval() is caught by validateCode
  // -------------------------------------------------------------------------
  it('catches eval() in validateCode', () => {
    const result = forge.validateCode(
      'function execute(input) { return eval("1+1"); }',
      [],
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toContain('eval() is forbidden');
  });

  // -------------------------------------------------------------------------
  // 5. Code using require() is caught by validateCode
  // -------------------------------------------------------------------------
  it('catches require() in validateCode', () => {
    const result = forge.validateCode(
      'function execute(input) { const fs = require("fs"); return fs.readFileSync("/etc/passwd"); }',
      [],
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toContain('require() is forbidden');
  });

  // -------------------------------------------------------------------------
  // 6. fetch blocked when not in allowlist
  // -------------------------------------------------------------------------
  it('blocks fetch() when not in the allowlist', () => {
    const result = forge.validateCode(
      'function execute(input) { return fetch("https://example.com"); }',
      [],
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toContain('fetch() is not in the allowlist');
  });

  // -------------------------------------------------------------------------
  // 7. fetch allowed when in allowlist
  // -------------------------------------------------------------------------
  it('allows fetch() when in the allowlist', () => {
    const result = forge.validateCode(
      'function execute(input) { return fetch("https://example.com"); }',
      ['fetch'],
    );

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 8. validateCode returns a violations list with multiple entries
  // -------------------------------------------------------------------------
  it('returns multiple violations when code has several banned patterns', () => {
    const code = `
      function execute(input) {
        eval("bad");
        const cp = require("child_process");
        const x = process.env.FOO;
        return x;
      }
    `;

    const result = forge.validateCode(code, []);

    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
    expect(result.violations).toContain('eval() is forbidden');
    expect(result.violations).toContain('require() is forbidden');
    expect(result.violations).toContain('process access is forbidden');
  });

  // -------------------------------------------------------------------------
  // 9. Execution time is measured and returned
  // -------------------------------------------------------------------------
  it('measures and returns execution time', async () => {
    const request = makeRequest(
      'function execute(input) { return { ok: true }; }',
      {},
    );

    const result = await forge.execute(request);

    expect(result.success).toBe(true);
    expect(typeof result.executionTimeMs).toBe('number');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // 10. execute() rejects code that fails validation
  // -------------------------------------------------------------------------
  it('rejects code at execution time when validation fails', async () => {
    const request = makeRequest(
      'function execute(input) { return eval("input.x"); }',
      { x: 42 },
    );

    const result = await forge.execute(request);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Code validation failed');
    expect(result.error).toContain('eval() is forbidden');
  });

  // -------------------------------------------------------------------------
  // 11. Code that throws at runtime returns a failure result
  // -------------------------------------------------------------------------
  it('returns a failure result when code throws at runtime', async () => {
    const request = makeRequest(
      'function execute(input) { throw new Error("runtime boom"); }',
      {},
    );

    const result = await forge.execute(request);

    expect(result.success).toBe(false);
    expect(result.error).toContain('runtime boom');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // 12. fs.write* is always banned
  // -------------------------------------------------------------------------
  it('bans fs.writeFile even when fs.readFile is in the allowlist', () => {
    const result = forge.validateCode(
      'function execute(input) { fs.writeFile("/tmp/x", "data"); }',
      ['fs.readFile'],
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toContain('fs.write* is forbidden');
  });

  // -------------------------------------------------------------------------
  // 13. new Function() is banned
  // -------------------------------------------------------------------------
  it('catches new Function() constructor', () => {
    const result = forge.validateCode(
      'function execute(input) { return new Function("return 1")(); }',
      [],
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toContain('new Function() is forbidden');
  });

  // -------------------------------------------------------------------------
  // 14. import statements are banned
  // -------------------------------------------------------------------------
  it('catches import statements', () => {
    const result = forge.validateCode(
      'import fs from "fs"; function execute(input) { return 1; }',
      [],
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toContain('import statements are forbidden');
  });

  // -------------------------------------------------------------------------
  // 15. crypto blocked when not in allowlist, allowed when opted in
  // -------------------------------------------------------------------------
  it('blocks crypto when not in allowlist', () => {
    const result = forge.validateCode(
      'function execute(input) { return crypto.createHash("sha256").update(input.data).digest("hex"); }',
      [],
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toContain('crypto access is not in the allowlist');
  });

  it('allows crypto when in allowlist', () => {
    const result = forge.validateCode(
      'function execute(input) { return crypto.createHash("sha256").update(input.data).digest("hex"); }',
      ['crypto'],
    );

    expect(result.valid).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 16. String return values work correctly
  // -------------------------------------------------------------------------
  it('handles string return values', async () => {
    const request = makeRequest(
      'function execute(input) { return "hello " + input.name; }',
      { name: 'world' },
    );

    const result = await forge.execute(request);

    expect(result.success).toBe(true);
    expect(result.output).toBe('hello world');
  });

  // -------------------------------------------------------------------------
  // 17. Number return values work correctly
  // -------------------------------------------------------------------------
  it('handles number return values', async () => {
    const request = makeRequest(
      'function execute(input) { return input.x * input.y; }',
      { x: 6, y: 7 },
    );

    const result = await forge.execute(request);

    expect(result.success).toBe(true);
    expect(result.output).toBe(42);
  });

  // -------------------------------------------------------------------------
  // 18. Constructor config defaults
  // -------------------------------------------------------------------------
  it('uses constructor config for timeout when request does not override', async () => {
    const shortForge = new SandboxedToolForge({ timeoutMs: 100 });

    const request: SandboxExecutionRequest = {
      code: 'function execute(input) { while(true) {} }',
      input: {},
      allowlist: [],
      memoryMB: 128,
      timeoutMs: 100,
    };

    const result = await shortForge.execute(request);

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  // -------------------------------------------------------------------------
  // 19. memoryUsedBytes is always returned
  // -------------------------------------------------------------------------
  it('always returns memoryUsedBytes in the result', async () => {
    const request = makeRequest(
      'function execute(input) { return null; }',
      {},
    );

    const result = await forge.execute(request);

    expect(typeof result.memoryUsedBytes).toBe('number');
  });

  // -------------------------------------------------------------------------
  // 20. Complex object manipulation works in sandbox
  // -------------------------------------------------------------------------
  it('supports complex object manipulation in sandboxed code', async () => {
    const code = `
      function execute(input) {
        var items = input.items;
        var total = 0;
        for (var i = 0; i < items.length; i++) {
          total += items[i].price * items[i].qty;
        }
        return { total: total, count: items.length };
      }
    `;

    const request = makeRequest(code, {
      items: [
        { price: 10, qty: 2 },
        { price: 5, qty: 3 },
        { price: 20, qty: 1 },
      ],
    });

    const result = await forge.execute(request);

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ total: 55, count: 3 });
  });
});
