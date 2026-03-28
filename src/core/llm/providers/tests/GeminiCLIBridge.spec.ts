import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execaMock } = vi.hoisted(() => {
  const execaMock = vi.fn();
  return { execaMock };
});

vi.mock('execa', () => ({
  execa: execaMock,
}));

/* Mock fs for system prompt temp file */
const fsMocks = vi.hoisted(() => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs/promises', () => fsMocks);

import { GeminiCLIBridge } from '../implementations/GeminiCLIBridge';
import type { StreamEvent } from '../../../../sandbox/subprocess/types';

describe('GeminiCLIBridge', () => {
  let bridge: GeminiCLIBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    bridge = new GeminiCLIBridge();
  });

  describe('checkBinaryInstalled()', () => {
    it('returns binary path and version when gemini is installed', async () => {
      execaMock
        .mockResolvedValueOnce({ stdout: '/usr/local/bin/gemini\n' })
        .mockResolvedValueOnce({ stdout: 'gemini-cli 1.0.5\n' });

      const result = await bridge.checkBinaryInstalled();
      expect(result).toEqual({
        installed: true,
        binaryPath: '/usr/local/bin/gemini',
        version: '1.0.5',
      });
    });

    it('returns installed: false when gemini is not on PATH', async () => {
      execaMock.mockRejectedValueOnce(new Error('not found'));
      const result = await bridge.checkBinaryInstalled();
      expect(result).toEqual({ installed: false });
    });
  });

  describe('execute()', () => {
    it('spawns gemini with correct flags', async () => {
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify({ result: 'Hello', session_id: 'g1' }),
        exitCode: 0,
      });

      const result = await bridge.execute({
        prompt: 'Say hello',
        model: 'gemini-2.5-flash',
      });

      const [cmd, args, opts] = execaMock.mock.calls[0];
      expect(cmd).toBe('gemini');
      expect(args).toContain('-p');
      expect(args).toContain('--output-format');
      expect(args).toContain('json');
      expect(args).toContain('-m');
      expect(args).toContain('gemini-2.5-flash');
      expect(opts.input).toBe('Say hello');
      expect(result.result).toBe('Hello');
    });

    it('does NOT include --bare, --max-turns, or --system-prompt flags', async () => {
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify({ result: 'ok' }),
        exitCode: 0,
      });

      await bridge.execute({ prompt: 'test', systemPrompt: 'Be helpful' });

      const [, args] = execaMock.mock.calls[0];
      expect(args).not.toContain('--bare');
      expect(args).not.toContain('--max-turns');
      expect(args).not.toContain('--system-prompt');
    });

    it('wraps ENOENT as BINARY_NOT_FOUND', async () => {
      execaMock.mockRejectedValueOnce(
        Object.assign(new Error('spawn gemini ENOENT'), { code: 'ENOENT', stderr: '' }),
      );

      try {
        await bridge.execute({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err: any) {
        expect(err.code).toBe('BINARY_NOT_FOUND');
        expect(err.binaryName).toBe('gemini');
        expect(err.guidance).toContain('npm install -g @google/gemini-cli');
      }
    });
  });

  describe('executeWithSystemPrompt()', () => {
    it('writes temp file and sets GEMINI_SYSTEM_MD env', async () => {
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify({ result: 'ok' }),
        exitCode: 0,
      });

      await bridge.executeWithSystemPrompt({
        prompt: 'Hello',
        systemPrompt: 'You are a helpful assistant.',
      });

      /* Temp file was written */
      expect(fsMocks.writeFile).toHaveBeenCalledOnce();
      const [filePath, content] = fsMocks.writeFile.mock.calls[0];
      expect(filePath).toContain('agentos-gemini-sys-');
      expect(content).toBe('You are a helpful assistant.');

      /* GEMINI_SYSTEM_MD was set in subprocess env */
      const [, , opts] = execaMock.mock.calls[0];
      expect(opts.env).toBeDefined();
      expect(opts.env.GEMINI_SYSTEM_MD).toBe(filePath);

      /* Temp file was cleaned up */
      expect(fsMocks.unlink).toHaveBeenCalledOnce();
    });

    it('passes through to execute() when no systemPrompt', async () => {
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify({ result: 'ok' }),
        exitCode: 0,
      });

      await bridge.executeWithSystemPrompt({ prompt: 'Hello' });

      /* No temp file written */
      expect(fsMocks.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('stream()', () => {
    it('yields parsed StreamEvents', async () => {
      const lines = [
        JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }),
        JSON.stringify({ type: 'result', result: 'Hi there', usage: { input_tokens: 5, output_tokens: 3 } }),
      ];

      const mockStdout = (async function* () {
        for (const line of lines) {
          yield Buffer.from(line + '\n');
        }
      })();

      execaMock.mockReturnValueOnce({
        stdout: mockStdout,
        exitCode: Promise.resolve(0),
        kill: vi.fn(),
      });

      const events: StreamEvent[] = [];
      for await (const event of bridge.stream({ prompt: 'Hello' })) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: 'text_delta', text: 'Hi' });
      expect(events[1].type).toBe('result');
    });
  });
});
