import { describe, it, expect } from 'vitest';
import { isQuotaError } from '../quotaErrors.js';

describe('isQuotaError', () => {
  it('detects HTTP 429', () => {
    expect(isQuotaError(429, '')).toBe(true);
  });

  it('detects HTTP 402 payment required', () => {
    expect(isQuotaError(402, '')).toBe(true);
  });

  it('detects ElevenLabs quota_exceeded', () => {
    expect(isQuotaError(401, '{"detail":{"status":"quota_exceeded"}}')).toBe(true);
  });

  it('detects OpenAI insufficient_quota', () => {
    expect(isQuotaError(403, '{"error":{"code":"insufficient_quota"}}')).toBe(true);
  });

  it('detects Anthropic overloaded_error', () => {
    expect(isQuotaError(529, '{"type":"error","error":{"type":"overloaded_error"}}')).toBe(true);
  });

  it('detects OpenRouter rate_limit_exceeded', () => {
    expect(isQuotaError(429, '{"error":{"code":"rate_limit_exceeded"}}')).toBe(true);
  });

  it('detects Gemini RESOURCE_EXHAUSTED', () => {
    expect(isQuotaError(429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}')).toBe(true);
  });

  it('detects DeepL 456 quota exceeded', () => {
    expect(isQuotaError(456, '')).toBe(true);
  });

  it('returns false for normal 4xx', () => {
    expect(isQuotaError(400, '{"error":"bad request"}')).toBe(false);
    expect(isQuotaError(401, '{"error":"unauthorized"}')).toBe(false);
    expect(isQuotaError(404, '')).toBe(false);
  });

  it('returns false for 5xx server errors', () => {
    expect(isQuotaError(500, '{"error":"internal"}')).toBe(false);
    expect(isQuotaError(503, '')).toBe(false);
  });
});
