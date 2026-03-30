/**
 * @file hitl.guardrail-override.test.ts
 * @description Unit tests for the post-approval guardrail override system.
 *
 * Covers:
 * 1. Guardrail blocks auto-approved destructive tool call (code-safety).
 * 2. Guardrail passes safe tool call through.
 * 3. guardrailOverride: false disables the check.
 * 4. Guardrail override emits the right event via callbacks.
 * 5. Multiple guardrails — first block wins.
 * 6. PII guardrail blocks unredacted SSN.
 * 7. Unknown guardrail ID passes through (allow).
 */

import { describe, it, expect, vi } from 'vitest';
import { runPostApprovalGuardrails } from '../agency.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('post-approval guardrail override', () => {
  // -------------------------------------------------------------------------
  // 1. Guardrail blocks auto-approved destructive tool call
  // -------------------------------------------------------------------------

  it('blocks a destructive rm -rf command via code-safety guardrail', async () => {
    const result = await runPostApprovalGuardrails(
      'shell_execute',
      { command: 'rm -rf /' },
      ['code-safety'],
    );

    expect(result.passed).toBe(false);
    expect(result.guardrailId).toBe('code-safety');
    expect(result.reason).toContain('destructive pattern');
  });

  // -------------------------------------------------------------------------
  // 2. Guardrail passes safe tool call through
  // -------------------------------------------------------------------------

  it('passes a safe tool call through', async () => {
    const result = await runPostApprovalGuardrails(
      'read_file',
      { path: '/tmp/notes.txt' },
      ['code-safety', 'pii-redaction'],
    );

    expect(result.passed).toBe(true);
    expect(result.guardrailId).toBeUndefined();
    expect(result.reason).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 3. guardrailOverride: false disables the check (empty guardrail list)
  // -------------------------------------------------------------------------

  it('passes when no guardrail IDs are configured', async () => {
    const result = await runPostApprovalGuardrails(
      'shell_execute',
      { command: 'rm -rf /' },
      [], // no guardrails configured
    );

    expect(result.passed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. Guardrail override emits the right event via callbacks
  // -------------------------------------------------------------------------

  it('fires guardrailResult callback when a guardrail blocks', async () => {
    const guardrailResultCb = vi.fn();
    const callbacks = { guardrailResult: guardrailResultCb };

    await runPostApprovalGuardrails(
      'shell_execute',
      { command: 'rm -rf /' },
      ['code-safety'],
      callbacks as any,
    );

    expect(guardrailResultCb).toHaveBeenCalledOnce();
    const event = guardrailResultCb.mock.calls[0][0];
    expect(event.guardrailId).toBe('code-safety');
    expect(event.passed).toBe(false);
    expect(event.enforced).toBe(true);
    expect(event.action).toBe('block');
    expect(event.reason).toContain('destructive pattern');
  });

  it('fires guardrailResult callback with passed=true for safe calls', async () => {
    const guardrailResultCb = vi.fn();
    const callbacks = { guardrailResult: guardrailResultCb };

    await runPostApprovalGuardrails(
      'read_file',
      { path: '/tmp/notes.txt' },
      ['code-safety'],
      callbacks as any,
    );

    expect(guardrailResultCb).toHaveBeenCalledOnce();
    const event = guardrailResultCb.mock.calls[0][0];
    expect(event.passed).toBe(true);
    expect(event.action).toBe('allow');
  });

  // -------------------------------------------------------------------------
  // 5. Multiple guardrails — first block wins
  // -------------------------------------------------------------------------

  it('stops at the first blocking guardrail', async () => {
    const guardrailResultCb = vi.fn();

    const result = await runPostApprovalGuardrails(
      'shell_execute',
      { command: 'rm -rf /home/user' },
      ['code-safety', 'pii-redaction'],
      { guardrailResult: guardrailResultCb } as any,
    );

    expect(result.passed).toBe(false);
    expect(result.guardrailId).toBe('code-safety');
    // Only one callback fired because we stopped at the first block.
    expect(guardrailResultCb).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 6. PII guardrail blocks unredacted SSN
  // -------------------------------------------------------------------------

  it('blocks tool call containing an unredacted SSN', async () => {
    const result = await runPostApprovalGuardrails(
      'send_email',
      { body: 'SSN is 123-45-6789' },
      ['pii-redaction'],
    );

    expect(result.passed).toBe(false);
    expect(result.guardrailId).toBe('pii-redaction');
    expect(result.reason).toContain('SSN');
  });

  // -------------------------------------------------------------------------
  // 7. Unknown guardrail ID passes through
  // -------------------------------------------------------------------------

  it('unknown guardrail ID passes through as allow', async () => {
    const result = await runPostApprovalGuardrails(
      'shell_execute',
      { command: 'rm -rf /' },
      ['custom-enterprise-guardrail'],
    );

    // The unknown guardrail passes, but code-safety was not in the list.
    expect(result.passed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Additional patterns
  // -------------------------------------------------------------------------

  it('blocks DROP TABLE pattern', async () => {
    const result = await runPostApprovalGuardrails(
      'db_query',
      { sql: 'DROP TABLE users;' },
      ['code-safety'],
    );

    expect(result.passed).toBe(false);
    expect(result.guardrailId).toBe('code-safety');
  });

  it('blocks credit card numbers via pii-redaction', async () => {
    const result = await runPostApprovalGuardrails(
      'log_data',
      { message: 'Card: 4111 1111 1111 1111' },
      ['pii-redaction'],
    );

    expect(result.passed).toBe(false);
    expect(result.guardrailId).toBe('pii-redaction');
    expect(result.reason).toContain('credit card');
  });
});
