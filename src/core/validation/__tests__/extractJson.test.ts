import { describe, it, expect } from 'vitest';
import { extractJson } from '../extractJson.js';

describe('extractJson', () => {
  it('returns raw JSON string when input is valid JSON object', () => {
    const input = '{"type":"semantic","content":"fact"}';
    expect(extractJson(input)).toBe(input);
  });

  it('returns raw JSON string when input is valid JSON array', () => {
    const input = '[{"a":1},{"b":2}]';
    expect(extractJson(input)).toBe(input);
  });

  it('extracts JSON from markdown fenced block with json tag', () => {
    const input = 'Here is the result:\n```json\n{"type":"semantic"}\n```\nDone.';
    expect(extractJson(input)).toBe('{"type":"semantic"}');
  });

  it('extracts JSON from markdown fenced block without tag', () => {
    const input = '```\n{"key":"value"}\n```';
    expect(extractJson(input)).toBe('{"key":"value"}');
  });

  it('strips <thinking> blocks before extraction', () => {
    const input = '<thinking>Let me reason about this.</thinking>\n{"type":"episodic","content":"event"}';
    expect(extractJson(input)).toBe('{"type":"episodic","content":"event"}');
  });

  it('extracts first JSON object via brace matching', () => {
    const input = 'Some preamble text {"type":"semantic","content":"a fact"} and trailing text';
    expect(extractJson(input)).toBe('{"type":"semantic","content":"a fact"}');
  });

  it('extracts first JSON array via bracket matching', () => {
    const input = 'Results: [{"a":1},{"b":2}] done';
    expect(extractJson(input)).toBe('[{"a":1},{"b":2}]');
  });

  it('handles nested objects in brace extraction', () => {
    const input = 'Result: {"outer":{"inner":"value"},"list":[1,2]}';
    expect(extractJson(input)).toBe('{"outer":{"inner":"value"},"list":[1,2]}');
  });

  it('parses JSONL (multiple JSON objects on separate lines) as array', () => {
    const input = '{"type":"a","content":"1"}\n{"type":"b","content":"2"}';
    const result = extractJson(input);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe('a');
    expect(parsed[1].type).toBe('b');
  });

  it('returns null for completely malformed input', () => {
    expect(extractJson('This is just plain text with no JSON')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractJson('')).toBeNull();
  });

  it('handles strings with escaped quotes inside JSON', () => {
    const input = '{"content":"She said \\"hello\\""}';
    expect(extractJson(input)).toBe(input);
  });
});
