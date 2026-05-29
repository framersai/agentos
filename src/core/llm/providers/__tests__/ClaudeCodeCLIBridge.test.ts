import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execaMock } = vi.hoisted(() => {
  const execaMock = vi.fn();
  return { execaMock };
});

vi.mock('execa', () => ({
  execa: execaMock,
}));

import {
  ClaudeCodeCLIBridge,
  type CLIBridgeOptions,
  type CLIBridgeResult,
  type StreamEvent,
} from '../implementations/ClaudeCodeCLIBridge';

describe('ClaudeCodeCLIBridge', () => {
  let bridge: ClaudeCodeCLIBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    bridge = new ClaudeCodeCLIBridge();
  });

  describe('checkBinaryInstalled()', () => {
    it('returns binary path and version when claude is installed', async () => {
      execaMock
        .mockResolvedValueOnce({ stdout: '/usr/local/bin/claude\n' })
        .mockResolvedValueOnce({ stdout: 'claude 1.5.0\n' });

      const result = await bridge.checkBinaryInstalled();
      expect(result).toEqual({
        installed: true,
        binaryPath: '/usr/local/bin/claude',
        version: '1.5.0',
      });
    });

    it('returns installed: false when claude is not on PATH', async () => {
      execaMock.mockRejectedValueOnce(new Error('not found'));

      const result = await bridge.checkBinaryInstalled();
      expect(result).toEqual({ installed: false });
    });
  });

  describe('checkAuthenticated()', () => {
    it('returns true when a health ping succeeds', async () => {
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify({ result: 'pong', session_id: 's1' }),
        exitCode: 0,
      });

      const result = await bridge.checkAuthenticated();
      expect(result).toBe(true);
    });

    it('returns false when health ping exits with non-zero', async () => {
      execaMock.mockRejectedValueOnce(Object.assign(new Error('auth'), { exitCode: 1, stderr: 'not logged in' }));

      const result = await bridge.checkAuthenticated();
      expect(result).toBe(false);
    });
  });

  describe('execute()', () => {
    it('spawns claude with correct flags for text-only call', async () => {
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify({ type: 'result', result: 'Hello world', session_id: 's123', usage: { input_tokens: 10, output_tokens: 5 } }),
        exitCode: 0,
      });

      const result = await bridge.execute({
        prompt: 'Say hello',
        systemPrompt: 'You are helpful.',
        model: 'claude-sonnet-4-20250514',
      });

      expect(execaMock).toHaveBeenCalledOnce();
      const [cmd, args, opts] = execaMock.mock.calls[0];
      expect(cmd).toBe('claude');
      expect(args).toContain('--bare');
      expect(args).toContain('-p');
      expect(args).toContain('--output-format');
      expect(args).toContain('json');
      expect(args).toContain('--max-turns');
      expect(args).toContain('1');
      expect(args).toContain('--system-prompt');
      expect(args).toContain('You are helpful.');
      expect(args).toContain('--model');
      expect(args).toContain('claude-sonnet-4-20250514');
      expect(opts.input).toBe('Say hello');

      expect(result.result).toBe('Hello world');
      expect(result.sessionId).toBe('s123');
      expect(result.isError).toBe(false);
    });

    it('includes --json-schema flag when jsonSchema option is provided', async () => {
      const schema = { type: 'object', properties: { text: { type: 'string' } } };
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify({ type: 'result', result: JSON.stringify({ text: 'hi' }), session_id: 's2' }),
        exitCode: 0,
      });

      await bridge.execute({
        prompt: 'Test',
        jsonSchema: schema,
      });

      const [, args] = execaMock.mock.calls[0];
      expect(args).toContain('--json-schema');
      expect(args).toContain(JSON.stringify(schema));
    });

    it('throws ClaudeCodeProviderError on non-zero exit code', async () => {
      execaMock.mockRejectedValueOnce(
        Object.assign(new Error('process failed'), { exitCode: 1, stderr: 'authentication required' }),
      );

      await expect(bridge.execute({ prompt: 'test' })).rejects.toThrow('Claude Code');
    });

    it('wraps ENOENT as BINARY_NOT_FOUND', async () => {
      execaMock.mockRejectedValueOnce(
        Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT', stderr: '' }),
      );

      try {
        await bridge.execute({ prompt: 'test' });
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err.code).toBe('BINARY_NOT_FOUND');
        expect(err.recoverable).toBe(false);
        expect(err.guidance).toContain('Install Claude Code');
      }
    });

    it('wraps timeout as TIMEOUT', async () => {
      execaMock.mockRejectedValueOnce(
        Object.assign(new Error('timed out'), { timedOut: true, stderr: '' }),
      );

      try {
        await bridge.execute({ prompt: 'test' });
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err.code).toBe('TIMEOUT');
        expect(err.recoverable).toBe(true);
      }
    });

    it('wraps rate limit stderr as RATE_LIMITED', async () => {
      execaMock.mockRejectedValueOnce(
        Object.assign(new Error('failed'), { exitCode: 1, stderr: 'rate limit exceeded' }),
      );

      try {
        await bridge.execute({ prompt: 'test' });
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err.code).toBe('RATE_LIMITED');
        expect(err.recoverable).toBe(true);
      }
    });
  });

  describe('stream()', () => {
    it('yields StreamEvent objects from stream-json output', async () => {
      const lines = [
        JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }),
        JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } }),
        JSON.stringify({ type: 'result', result: 'Hello world', session_id: 's1', usage: { input_tokens: 5, output_tokens: 2 } }),
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

      expect(events.length).toBe(3);
      expect(events[0]).toEqual({ type: 'text_delta', text: 'Hello' });
      expect(events[1]).toEqual({ type: 'text_delta', text: ' world' });
      expect(events[2].type).toBe('result');
    });

    it('passes streaming-specific flags', async () => {
      const mockStdout = (async function* () {
        yield Buffer.from(JSON.stringify({ type: 'result', result: 'ok' }) + '\n');
      })();

      execaMock.mockReturnValueOnce({
        stdout: mockStdout,
        exitCode: Promise.resolve(0),
        kill: vi.fn(),
      });

      const events: StreamEvent[] = [];
      for await (const event of bridge.stream({ prompt: 'test' })) {
        events.push(event);
      }

      const [, args] = execaMock.mock.calls[0];
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--verbose');
      expect(args).toContain('--include-partial-messages');
    });
  });
});
