import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  SocialAbstractService,
  type SocialRequestOptions,
  type SocialServiceConfig,
} from '../../src/channels/social-posting/SocialAbstractService';

class TestSocialService extends SocialAbstractService {
  constructor(config: SocialServiceConfig = {}) {
    super(config);
  }

  requestJson<T>(
    url: string,
    init: RequestInit = {},
    options: SocialRequestOptions = {},
  ): Promise<T> {
    return this.fetchJson<T>(url, init, options);
  }

  requestText(
    url: string,
    init: RequestInit = {},
    options: SocialRequestOptions = {},
  ): Promise<string> {
    return this.fetchText(url, init, options);
  }

  checkScopes(required: string[], granted: string[] = []): void {
    this.assertScopes(required, granted);
  }
}

describe('SocialAbstractService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries retryable HTTP statuses and then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new TestSocialService();
    const result = await service.requestJson<{ ok: boolean }>('https://example.com');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable HTTP statuses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('bad request', { status: 400, statusText: 'Bad Request' }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new TestSocialService();

    await expect(
      service.requestJson('https://example.com', {}, { maxRetries: 3 }),
    ).rejects.toThrow(/HTTP 400/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries transport errors and eventually succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(
        new Response('ok', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new TestSocialService();
    const text = await service.requestText('https://example.com');

    expect(text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serializes object bodies as JSON and sets content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new TestSocialService();
    await service.requestJson('https://example.com', {
      method: 'POST',
      body: { text: 'hello' } as unknown as BodyInit,
    });

    const call = fetchMock.mock.calls[0];
    const init = call[1] as RequestInit;
    expect(typeof init.body).toBe('string');
    expect(init.body).toBe('{"text":"hello"}');

    const headers = new Headers(init.headers ?? {});
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('enforces min request interval between calls', async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new TestSocialService({ minRequestIntervalMs: 25 });
    const start = Date.now();

    await service.requestJson('https://example.com/1');
    await service.requestJson('https://example.com/2');

    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(18);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when required OAuth scopes are missing', () => {
    const service = new TestSocialService();

    expect(() =>
      service.checkScopes(['w_member_social', 'r_liteprofile'], ['r_liteprofile']),
    ).toThrow(/Missing required OAuth scopes: w_member_social/);
  });

  it('accepts when all required OAuth scopes are granted', () => {
    const service = new TestSocialService();
    expect(() =>
      service.checkScopes(['w_member_social', 'r_liteprofile'], ['r_liteprofile', 'w_member_social']),
    ).not.toThrow();
  });
});
