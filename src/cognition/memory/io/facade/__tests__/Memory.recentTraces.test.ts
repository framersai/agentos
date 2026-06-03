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
  it('returns only traces created after the watermark', async () => {
    const mem = await makeMemory();
    // Drive the watermark from the older trace's OWN recorded created_at rather
    // than a wall-clock Date.now() guess: `> older.createdAt` excludes it
    // deterministically, and the newer trace (written after a delay) has a
    // strictly greater created_at.
    const older = await mem.remember('older fact', { type: 'episodic', scope: 'persona', scopeId: 'a1' });
    await new Promise((r) => setTimeout(r, 15));
    await mem.remember('newer fact', { type: 'episodic', scope: 'persona', scopeId: 'a1' });

    const recent = await mem.recentTraces(older.createdAt, { limit: 10 });
    const contents = recent.map((t) => t.content);
    expect(contents).toContain('newer fact');
    expect(contents).not.toContain('older fact');
  });

  it('returns oldest-first when order is "asc"', async () => {
    const mem = await makeMemory();
    await mem.remember('first fact', { type: 'episodic', scope: 'persona', scopeId: 'a1' });
    await new Promise((r) => setTimeout(r, 15));
    await mem.remember('second fact', { type: 'episodic', scope: 'persona', scopeId: 'a1' });

    const asc = await mem.recentTraces(0, { order: 'asc', limit: 10 });
    const contents = asc.map((t) => t.content);
    expect(contents.indexOf('first fact')).toBeLessThan(contents.indexOf('second fact'));
  });
});
