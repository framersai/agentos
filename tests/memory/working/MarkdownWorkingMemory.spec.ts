import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarkdownWorkingMemory } from '../../src/memory/working/MarkdownWorkingMemory.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('MarkdownWorkingMemory', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mwm-'));
    filePath = join(dir, 'working-memory.md');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates file with default template if missing', () => {
    const mwm = new MarkdownWorkingMemory(filePath);
    mwm.ensureFile();
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('# Working Memory');
  });

  it('creates file with custom template', () => {
    const mwm = new MarkdownWorkingMemory(filePath, '# Custom\n- Notes:');
    mwm.ensureFile();
    expect(readFileSync(filePath, 'utf8')).toBe('# Custom\n- Notes:');
  });

  it('reads existing file content', () => {
    const mwm = new MarkdownWorkingMemory(filePath);
    mwm.ensureFile();
    mwm.write('# Updated\nHello world');
    expect(mwm.read()).toBe('# Updated\nHello world');
  });

  it('write replaces entire content', () => {
    const mwm = new MarkdownWorkingMemory(filePath);
    mwm.ensureFile();
    mwm.write('First');
    mwm.write('Second');
    expect(mwm.read()).toBe('Second');
  });

  it('returns empty string if file does not exist', () => {
    const mwm = new MarkdownWorkingMemory(filePath);
    expect(mwm.read()).toBe('');
  });

  it('estimates token count', () => {
    const mwm = new MarkdownWorkingMemory(filePath);
    mwm.ensureFile();
    mwm.write('hello world foo bar');
    expect(mwm.estimateTokens()).toBeGreaterThan(0);
    expect(mwm.estimateTokens()).toBeLessThan(20);
  });

  it('enforces max token limit on write', () => {
    const mwm = new MarkdownWorkingMemory(filePath, '', 10);
    mwm.ensureFile();
    const longContent = 'word '.repeat(500);
    const result = mwm.write(longContent);
    expect(result.truncated).toBe(true);
  });
});
