import { describe, it, expect } from 'vitest';
import { renderToolSystemBlock } from '../renderer';

const tool = {
  id: 'x', name: 'recall_messages', displayName: 'Recall',
  description: 'Search past messages',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  execute: async () => ({ success: true }),
} as any;

describe('renderToolSystemBlock', () => {
  it('embeds each tool name, description, and schema in a <tools> block', () => {
    const block = renderToolSystemBlock([tool]);
    expect(block).toContain('<tools>');
    expect(block).toContain('</tools>');
    expect(block).toContain('recall_messages');
    expect(block).toContain('Search past messages');
    expect(block).toContain('"query"');
  });

  it('instructs the model on the <tool_call> emission format', () => {
    const block = renderToolSystemBlock([tool]);
    expect(block).toContain('<tool_call>');
    expect(block).toContain('<tool_response>');
  });

  it('produces valid JSON inside the <tools> block', () => {
    const block = renderToolSystemBlock([tool]);
    const json = block.match(/<tools>\s*([\s\S]*?)\s*<\/tools>/)![1];
    const parsed = JSON.parse(json);
    expect(parsed[0]).toMatchObject({ name: 'recall_messages' });
    expect(parsed[0].parameters).toMatchObject({ type: 'object' });
  });

  it('returns an empty string for no tools', () => {
    expect(renderToolSystemBlock([])).toBe('');
  });
});
