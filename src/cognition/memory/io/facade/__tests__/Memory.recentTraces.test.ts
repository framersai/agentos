import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Memory } from '../Memory.js';

const opened: Memory[] = [];
const dirs: string[] = [];

async function makeMemory(): Promise<Memory> {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'));
  dirs.push(d);
  const mem = await Memory.createSqlite(path.join(d, 'm.sqlite'), { graph: false, selfImprove: false, decay: false });
  opened.push(mem);
  return mem;
}

afterEach(async () => {
  for (const m of opened) {
    try {
      await m.close();
    } catch {
      /* */
    }
  }
  opened.length = 0;
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
  dirs.length = 0;
});

describe('Memory.recentTraces', () => {
  it('returns traces created after the watermark, newest first', async () => {
    const mem = await makeMemory();
    await mem.remember('older fact', { type: 'episodic', scope: 'persona', scopeId: 'a1' });
    await new Promise((r) => setTimeout(r, 15));
    const watermark = Date.now();
    await new Promise((r) => setTimeout(r, 15));
    await mem.remember('newer fact', { type: 'episodic', scope: 'persona', scopeId: 'a1' });

    const recent = await mem.recentTraces(watermark, { limit: 10 });
    const contents = recent.map((t) => t.content);
    expect(contents).toContain('newer fact');
    expect(contents).not.toContain('older fact');
  });
});
