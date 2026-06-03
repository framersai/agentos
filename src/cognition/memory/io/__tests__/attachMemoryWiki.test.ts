import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { attachMemoryWiki } from '../attachMemoryWiki.js';
import { ensureMemoryDir } from '../../../substrate/memory/wiki/index.js';

let dir: string;
let memoryDir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-'));
  memoryDir = ensureMemoryDir(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function fakeMemory() {
  let attached: any = null;
  let n = 0;
  const remembered: string[] = [];
  return {
    attached: () => attached,
    remembered,
    remember: async (content: string) => {
      remembered.push(content);
      return { id: `t${++n}` };
    },
    forget: async () => {},
    attachWiki: (w: any) => {
      attached = w;
    },
  };
}

describe('attachMemoryWiki', () => {
  it('attaches a wiki, appends read_memory_page, and boot-indexes existing pages', async () => {
    fs.mkdirSync(path.join(memoryDir, 'entities'), { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, 'entities', 'johnny.md'),
      '---\nid: entities/johnny\ntype: entity\n---\nFounder of Frame.',
    );

    const mem = fakeMemory();
    const existingTool = { name: 'other_tool' };
    const { tools, store } = await attachMemoryWiki({
      memory: mem as any,
      memoryDir,
      agentId: 'a1',
      llm: async () => 'merged',
      chunk: (t) => [{ text: t }],
      tools: [existingTool],
      now: () => '1970-01-01T00:00:00.000Z',
    });

    // attachWiki received a store + compiler
    expect(mem.attached()).toBeTruthy();
    expect(typeof mem.attached().compiler.compile).toBe('function');
    // boot index embedded the existing page body
    expect(mem.remembered.some((c) => c.includes('Founder of Frame.'))).toBe(true);
    // read_memory_page appended after existing tools
    const names = tools.map((t: any) => t.name);
    expect(names).toEqual(['other_tool', 'read_memory_page']);
    // store handle is returned
    expect(typeof store.readPage).toBe('function');
  });
});
