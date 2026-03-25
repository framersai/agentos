/**
 * @file hitl-handlers.test.ts
 * Tests for the HITL (Human-in-the-Loop) approval handler factories.
 *
 * Validates:
 * - `hitl.autoApprove()` always returns `{ approved: true }`
 * - `hitl.autoReject()` always returns `{ approved: false }` with the expected reason
 * - `hitl.webhook()` POSTs the request to the URL and parses the response
 * - `hitl.slack()` posts a message and auto-approves for v1
 * - `hitl.cli()` is a factory function (interactive prompt, not exercised in CI)
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { hitl } from '../hitl.js';
import type { ApprovalRequest } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid ApprovalRequest for tests. */
function makeRequest(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: 'req-test-1',
    type: 'tool',
    agent: 'executor',
    action: 'delete-file',
    description: 'Delete /tmp/test.txt',
    details: { path: '/tmp/test.txt' },
    context: {
      agentCalls: [],
      totalTokens: 100,
      totalCostUSD: 0.01,
      elapsedMs: 500,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// autoApprove
// ---------------------------------------------------------------------------

describe('hitl.autoApprove()', () => {
  it('returns approved: true', async () => {
    const handler = hitl.autoApprove();
    const decision = await handler(makeRequest());
    expect(decision.approved).toBe(true);
  });

  it('returns approved: true for every request type', async () => {
    const handler = hitl.autoApprove();
    const types = ['tool', 'agent', 'emergent', 'output', 'strategy-override'] as const;
    for (const type of types) {
      const decision = await handler(makeRequest({ type }));
      expect(decision.approved).toBe(true);
    }
  });

  it('is a factory that produces a new function each call', () => {
    const h1 = hitl.autoApprove();
    const h2 = hitl.autoApprove();
    expect(typeof h1).toBe('function');
    expect(typeof h2).toBe('function');
    // Each call returns a distinct function instance.
    expect(h1).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// autoReject
// ---------------------------------------------------------------------------

describe('hitl.autoReject()', () => {
  it('returns approved: false', async () => {
    const handler = hitl.autoReject();
    const decision = await handler(makeRequest());
    expect(decision.approved).toBe(false);
  });

  it('returns the default reason when none is provided', async () => {
    const handler = hitl.autoReject();
    const decision = await handler(makeRequest());
    expect(decision.reason).toBe('Auto-rejected');
  });

  it('returns the custom reason when provided', async () => {
    const handler = hitl.autoReject('dry-run mode');
    const decision = await handler(makeRequest());
    expect(decision.reason).toBe('dry-run mode');
  });

  it('returns approved: false for every request type', async () => {
    const handler = hitl.autoReject();
    const types = ['tool', 'agent', 'emergent', 'output', 'strategy-override'] as const;
    for (const type of types) {
      const decision = await handler(makeRequest({ type }));
      expect(decision.approved).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// webhook
// ---------------------------------------------------------------------------

describe('hitl.webhook()', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the request to the configured URL', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ approved: true }),
    });

    const handler = hitl.webhook('https://example.com/approve');
    await handler(makeRequest());

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/approve');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('sends the full request body as JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ approved: true }),
    });

    const req = makeRequest({ action: 'create-file', description: 'Create /tmp/new.txt' });
    const handler = hitl.webhook('https://example.com/approve');
    await handler(req);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as ApprovalRequest;
    expect(body.action).toBe('create-file');
    expect(body.description).toBe('Create /tmp/new.txt');
  });

  it('returns approved: true when server responds with approved: true', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ approved: true, reason: 'looks safe' }),
    });

    const handler = hitl.webhook('https://example.com/approve');
    const decision = await handler(makeRequest());
    expect(decision.approved).toBe(true);
    expect(decision.reason).toBe('looks safe');
  });

  it('returns approved: false when server responds with approved: false', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ approved: false, reason: 'too risky' }),
    });

    const handler = hitl.webhook('https://example.com/approve');
    const decision = await handler(makeRequest());
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe('too risky');
  });

  it('returns approved: false when the server returns a non-2xx status', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });

    const handler = hitl.webhook('https://example.com/approve');
    const decision = await handler(makeRequest());
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe('Webhook returned 503');
  });

  it('returns approved: false for 404 status', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });

    const handler = hitl.webhook('https://example.com/approve');
    const decision = await handler(makeRequest());
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe('Webhook returned 404');
  });
});

// ---------------------------------------------------------------------------
// slack
// ---------------------------------------------------------------------------

describe('hitl.slack()', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the Slack chat.postMessage API', async () => {
    const handler = hitl.slack({ channel: '#approvals', token: 'xoxb-test-token' });
    await handler(makeRequest());

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://slack.com/api/chat.postMessage');
  });

  it('sends the bot token in the Authorization header', async () => {
    const handler = hitl.slack({ channel: '#approvals', token: 'xoxb-test-token' });
    await handler(makeRequest());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer xoxb-test-token');
  });

  it('includes the channel in the request body', async () => {
    const handler = hitl.slack({ channel: 'C0123456789', token: 'xoxb-test-token' });
    await handler(makeRequest());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.channel).toBe('C0123456789');
  });

  it('includes the request description in the message text', async () => {
    const req = makeRequest({ description: 'Delete production database' });
    const handler = hitl.slack({ channel: '#approvals', token: 'xoxb-test-token' });
    await handler(req);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.text as string).toContain('Delete production database');
  });

  it('auto-approves for v1 after sending the notification', async () => {
    const handler = hitl.slack({ channel: '#approvals', token: 'xoxb-test-token' });
    const decision = await handler(makeRequest());
    expect(decision.approved).toBe(true);
    expect(decision.reason).toContain('auto-approved');
  });
});

// ---------------------------------------------------------------------------
// cli
// ---------------------------------------------------------------------------

describe('hitl.cli()', () => {
  it('is a factory that returns a function', () => {
    const handler = hitl.cli();
    expect(typeof handler).toBe('function');
  });

  it('produces a new function on each call', () => {
    const h1 = hitl.cli();
    const h2 = hitl.cli();
    expect(h1).not.toBe(h2);
  });

  // The interactive readline prompt is not exercised in automated tests
  // because it requires a real stdin TTY. The factory is verified above.
});

// ---------------------------------------------------------------------------
// HitlHandler type compatibility
// ---------------------------------------------------------------------------

describe('HitlHandler type compatibility', () => {
  it('all built-in handlers conform to the (request) => Promise<ApprovalDecision> signature', async () => {
    const handlers = [
      hitl.autoApprove(),
      hitl.autoReject(),
      hitl.autoReject('custom reason'),
    ];

    for (const handler of handlers) {
      const decision = await handler(makeRequest());
      expect(typeof decision.approved).toBe('boolean');
    }
  });
});
