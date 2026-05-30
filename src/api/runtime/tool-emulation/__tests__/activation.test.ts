import { describe, it, expect } from 'vitest';
import { resolveShimActive, formatToolResponse } from '../activation';

describe('resolveShimActive', () => {
  it('auto: active only when native tool-use is unsupported', () => {
    expect(resolveShimActive('auto', false)).toBe(true);
    expect(resolveShimActive('auto', true)).toBe(false);
  });
  it('native: never active', () => {
    expect(resolveShimActive('native', false)).toBe(false);
    expect(resolveShimActive('native', true)).toBe(false);
  });
  it('prompt: always active', () => {
    expect(resolveShimActive('prompt', true)).toBe(true);
    expect(resolveShimActive('prompt', false)).toBe(true);
  });
  it('defaults to auto when undefined', () => {
    expect(resolveShimActive(undefined, false)).toBe(true);
    expect(resolveShimActive(undefined, true)).toBe(false);
  });
});

describe('formatToolResponse', () => {
  it('wraps a success output', () => {
    expect(formatToolResponse('a', { success: true, output: { n: 1 } }))
      .toBe('<tool_response>{"name":"a","output":{"n":1}}</tool_response>');
  });
  it('wraps an error', () => {
    expect(formatToolResponse('a', { success: false, error: 'boom' }))
      .toBe('<tool_response>{"name":"a","error":"boom"}</tool_response>');
  });
});
