import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MarkdownWorkingMemory } from '../../../src/memory/core/working/MarkdownWorkingMemory.js';
import { UpdateWorkingMemoryTool } from '../../../src/memory/core/working/UpdateWorkingMemoryTool.js';
import { ReadWorkingMemoryTool } from '../../../src/memory/core/working/ReadWorkingMemoryTool.js';

const mockContext = {
  gmiId: 'test-gmi',
  personaId: 'test-persona',
  userContext: { userId: 'test-user' },
} as any;

describe('WorkingMemoryTools', () => {
  let tmpDir: string;
  let memory: MarkdownWorkingMemory;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wm-tools-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('UpdateWorkingMemoryTool', () => {
    it('successfully writes content and returns tokensUsed', async () => {
      memory = new MarkdownWorkingMemory(join(tmpDir, 'memory.md'));
      const tool = new UpdateWorkingMemoryTool(memory);

      const result = await tool.execute({ content: '# Hello World' }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output!.tokensUsed).toBeGreaterThan(0);
      expect(result.output!.truncated).toBe(false);
    });

    it('returns truncated: true when content exceeds max tokens', async () => {
      // maxTokens=10 means ~40 chars before truncation
      memory = new MarkdownWorkingMemory(join(tmpDir, 'memory.md'), '', 10);
      const tool = new UpdateWorkingMemoryTool(memory);

      const longContent = 'A'.repeat(200);
      const result = await tool.execute({ content: longContent }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output!.truncated).toBe(true);
    });

    it('returns success: false on write failure', async () => {
      // Point to a path under a file (not a directory) so mkdir fails
      const blockingFile = join(tmpDir, 'blocker');
      const { writeFileSync } = await import('node:fs');
      writeFileSync(blockingFile, 'x');
      memory = new MarkdownWorkingMemory(join(blockingFile, 'sub', 'memory.md'));
      const tool = new UpdateWorkingMemoryTool(memory);

      const result = await tool.execute({ content: '# test' }, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('ReadWorkingMemoryTool', () => {
    it('returns current file content', async () => {
      const filePath = join(tmpDir, 'memory.md');
      memory = new MarkdownWorkingMemory(filePath);
      memory.write('# My Notes\n\nSome context here.');
      const tool = new ReadWorkingMemoryTool(memory);

      const result = await tool.execute({} as any, mockContext);

      expect(result.success).toBe(true);
      expect(result.output!.content).toContain('# My Notes');
      expect(result.output!.content).toContain('Some context here.');
    });

    it('returns empty content when file does not exist', async () => {
      memory = new MarkdownWorkingMemory(join(tmpDir, 'nonexistent.md'));
      const tool = new ReadWorkingMemoryTool(memory);

      const result = await tool.execute({} as any, mockContext);

      expect(result.success).toBe(true);
      expect(result.output!.content).toBe('');
      expect(result.output!.tokensUsed).toBe(0);
    });

    it('returns correct token estimate', async () => {
      const filePath = join(tmpDir, 'memory.md');
      memory = new MarkdownWorkingMemory(filePath);
      // 40 chars => ceil(40/4) = 10 tokens
      memory.write('A'.repeat(40));
      const tool = new ReadWorkingMemoryTool(memory);

      const result = await tool.execute({} as any, mockContext);

      expect(result.success).toBe(true);
      expect(result.output!.tokensUsed).toBe(10);
    });
  });
});
