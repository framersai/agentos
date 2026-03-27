import { describe, expect, it } from 'vitest';
import { parseToolCallsFromText } from '../TextToolCallParser.js';

describe('TextToolCallParser', () => {
  it('parses JSON in a markdown fence', () => {
    const text = [
      'I need to search for this information.',
      '',
      '```json',
      '{"tool": "web_search", "arguments": {"query": "AgentOS features"}}',
      '```',
    ].join('\n');

    const calls = parseToolCallsFromText(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      name: 'web_search',
      arguments: { query: 'AgentOS features' },
    });
  });

  it('parses Action/Input (ReAct) format', () => {
    const text = [
      'Thought: I need to search for information about AgentOS.',
      'Action: web_search',
      'Input: {"query": "AgentOS features"}',
    ].join('\n');

    const calls = parseToolCallsFromText(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      name: 'web_search',
      arguments: { query: 'AgentOS features' },
    });
  });

  it('parses multiple tool calls in one response', () => {
    const text = [
      'Let me gather some information.',
      '',
      '```json',
      '{"tool": "web_search", "arguments": {"query": "AgentOS"}}',
      '```',
      '',
      'And also check the documentation:',
      '',
      '```json',
      '{"tool": "read_file", "arguments": {"path": "/docs/README.md"}}',
      '```',
    ].join('\n');

    const calls = parseToolCallsFromText(text);
    expect(calls).toHaveLength(2);
    expect(calls[0].name).toBe('web_search');
    expect(calls[1].name).toBe('read_file');
    expect(calls[1].arguments).toEqual({ path: '/docs/README.md' });
  });

  it('returns empty array when no tool calls are found', () => {
    const text = 'This is just a regular response with no tool calls at all.';
    const calls = parseToolCallsFromText(text);
    expect(calls).toEqual([]);
  });

  it('handles malformed JSON gracefully', () => {
    const text = [
      'Here is my tool call:',
      '',
      '```json',
      '{"tool": "web_search", "arguments": {bad json}}',
      '```',
    ].join('\n');

    const calls = parseToolCallsFromText(text);
    expect(calls).toEqual([]);
  });

  it('handles mixed format (JSON fence + Action/Input)', () => {
    const text = [
      'First I will search:',
      '',
      '```json',
      '{"tool": "web_search", "arguments": {"query": "AgentOS"}}',
      '```',
      '',
      'Then I need another lookup.',
      'Thought: Let me check the file system.',
      'Action: read_file',
      'Input: {"path": "/tmp/data.txt"}',
    ].join('\n');

    const calls = parseToolCallsFromText(text);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      name: 'web_search',
      arguments: { query: 'AgentOS' },
    });
    expect(calls[1]).toEqual({
      name: 'read_file',
      arguments: { path: '/tmp/data.txt' },
    });
  });
});
