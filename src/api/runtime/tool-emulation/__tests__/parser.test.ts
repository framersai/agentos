import { describe, it, expect } from 'vitest';
import { parseToolCalls } from '../parser';

describe('parseToolCalls', () => {
  it('extracts a single tool call and strips it from text', () => {
    const out = parseToolCalls('Let me check.\n<tool_call>{"name":"recall_messages","arguments":{"query":"beach"}}</tool_call>');
    expect(out.calls).toEqual([{ name: 'recall_messages', arguments: { query: 'beach' } }]);
    expect(out.cleanedText).toBe('Let me check.');
    expect(out.parseErrors).toEqual([]);
  });

  it('extracts multiple tool calls in order', () => {
    const out = parseToolCalls(
      '<tool_call>{"name":"a","arguments":{}}</tool_call><tool_call>{"name":"b","arguments":{"x":1}}</tool_call>'
    );
    expect(out.calls.map((c) => c.name)).toEqual(['a', 'b']);
    expect(out.calls[1].arguments).toEqual({ x: 1 });
  });

  it('returns no calls for plain prose', () => {
    const out = parseToolCalls('Just a normal answer.');
    expect(out.calls).toEqual([]);
    expect(out.cleanedText).toBe('Just a normal answer.');
  });

  it('records a parse error for malformed JSON without throwing', () => {
    const out = parseToolCalls('<tool_call>{"name":"a", oops}</tool_call>');
    expect(out.calls).toEqual([]);
    expect(out.parseErrors).toHaveLength(1);
    expect(out.parseErrors[0].raw).toContain('oops');
  });

  it('records a parse error when name is missing', () => {
    const out = parseToolCalls('<tool_call>{"arguments":{}}</tool_call>');
    expect(out.calls).toEqual([]);
    expect(out.parseErrors[0].message).toMatch(/name/i);
  });

  it('defaults arguments to {} when omitted', () => {
    const out = parseToolCalls('<tool_call>{"name":"ping"}</tool_call>');
    expect(out.calls).toEqual([{ name: 'ping', arguments: {} }]);
  });

  it('also strips stray tool_response tags from cleaned text', () => {
    const out = parseToolCalls('answer <tool_response>{"x":1}</tool_response>');
    expect(out.cleanedText).toBe('answer');
  });
});
