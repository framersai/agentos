import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadSoulSync } from '../SoulLoader.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-'));
  fs.writeFileSync(path.join(dir, 'SOUL.md'), '---\nname: Aria\n---\nYou are Aria.');
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SoulLoader wiki memory', () => {
  it('migrates a legacy MEMORY.md and exposes memoryDir + wikiIndex', () => {
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# Facts\n\nUser prefers terse commits.');
    const loaded = loadSoulSync({ source: path.join(dir, 'SOUL.md') });
    expect(loaded.memoryDir).toBe(path.join(dir, 'memory'));
    expect(loaded.wikiIndex).toContain('User prefers terse commits.');
    expect(fs.existsSync(path.join(dir, 'MEMORY.md'))).toBe(true); // non-destructive
  });

  it('prefers an existing memory/ over MEMORY.md', () => {
    fs.mkdirSync(path.join(dir, 'memory'));
    fs.writeFileSync(path.join(dir, 'memory', 'index.md'), '# Memory Index\n\nfrom wiki');
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), 'legacy ignored');
    const loaded = loadSoulSync({ source: path.join(dir, 'SOUL.md') });
    expect(loaded.wikiIndex).toContain('from wiki');
  });
});
