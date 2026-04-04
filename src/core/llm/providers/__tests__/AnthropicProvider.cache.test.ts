import { describe, it, expect } from 'vitest';

/**
 * Test the system block extraction logic that AnthropicProvider.buildRequestPayload
 * uses to decide whether to emit system as a plain string or content block array.
 *
 * Since buildRequestPayload is private, we replicate the extraction logic here
 * as a pure function and validate the behavior.
 */

type SystemBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };

function buildSystemPayload(
  messages: Array<{ role: string; content: string | Array<Record<string, any>> | null }>
): string | SystemBlock[] {
  const systemBlocks: SystemBlock[] = [];

  for (const msg of messages) {
    if (msg.role !== 'system') continue;

    if (typeof msg.content === 'string') {
      if (msg.content) systemBlocks.push({ type: 'text', text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          const block: SystemBlock = { type: 'text', text: part.text };
          if (part.cache_control) block.cache_control = part.cache_control;
          systemBlocks.push(block);
        }
      }
    }
  }

  if (systemBlocks.length === 0) return '';

  const hasCacheMarkers = systemBlocks.some(b => b.cache_control);
  return hasCacheMarkers ? systemBlocks : systemBlocks.map(b => b.text).join('\n\n');
}

describe('AnthropicProvider system prompt cache control', () => {
  it('joins plain string system messages into a single string', () => {
    const result = buildSystemPayload([
      { role: 'system', content: 'You are helpful.' },
      { role: 'system', content: 'Be concise.' },
    ]);
    expect(result).toBe('You are helpful.\n\nBe concise.');
  });

  it('returns content block array when cache_control markers are present', () => {
    const result = buildSystemPayload([
      {
        role: 'system',
        content: [
          { type: 'text', text: 'Static instructions', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'Dynamic state' },
        ],
      },
    ]);
    expect(Array.isArray(result)).toBe(true);
    const blocks = result as SystemBlock[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: 'text',
      text: 'Static instructions',
      cache_control: { type: 'ephemeral' },
    });
    expect(blocks[1]).toEqual({
      type: 'text',
      text: 'Dynamic state',
    });
  });

  it('falls back to joined string when no cache_control markers exist on content blocks', () => {
    const result = buildSystemPayload([
      {
        role: 'system',
        content: [
          { type: 'text', text: 'Part A' },
          { type: 'text', text: 'Part B' },
        ],
      },
    ]);
    expect(typeof result).toBe('string');
    expect(result).toBe('Part A\n\nPart B');
  });

  it('handles mixed string and content block system messages', () => {
    const result = buildSystemPayload([
      { role: 'system', content: 'Preamble' },
      {
        role: 'system',
        content: [
          { type: 'text', text: 'Cached block', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'Dynamic block' },
        ],
      },
    ]);
    expect(Array.isArray(result)).toBe(true);
    const blocks = result as SystemBlock[];
    expect(blocks).toHaveLength(3);
    expect(blocks[0].text).toBe('Preamble');
    expect(blocks[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('skips empty string system messages', () => {
    const result = buildSystemPayload([
      { role: 'system', content: '' },
      { role: 'system', content: 'Real content' },
    ]);
    expect(result).toBe('Real content');
  });

  it('ignores non-system messages', () => {
    const result = buildSystemPayload([
      { role: 'system', content: 'System msg' },
      { role: 'user', content: 'User msg' },
    ]);
    expect(result).toBe('System msg');
  });
});
