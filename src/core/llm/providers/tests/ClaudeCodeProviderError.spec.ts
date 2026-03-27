import { describe, expect, it } from 'vitest';
import { ClaudeCodeProviderError } from '../errors/ClaudeCodeProviderError';
import { CLISubprocessError } from '../../../../core/subprocess/errors';

describe('ClaudeCodeProviderError', () => {
  it('extends CLISubprocessError with guidance and recoverable fields', () => {
    const err = new ClaudeCodeProviderError(
      'Claude Code CLI is not installed.',
      'BINARY_NOT_FOUND',
      'Install it: npm install -g @anthropic-ai/claude-code',
      false,
    );

    expect(err).toBeInstanceOf(CLISubprocessError);
    expect(err).toBeInstanceOf(ClaudeCodeProviderError);
    expect(err.name).toBe('ClaudeCodeProviderError');
    expect(err.code).toBe('BINARY_NOT_FOUND');
    expect(err.binaryName).toBe('claude');
    expect(err.guidance).toBe('Install it: npm install -g @anthropic-ai/claude-code');
    expect(err.recoverable).toBe(false);
    expect(err.message).toBe('Claude Code CLI is not installed.');
  });

  it('defaults recoverable to false', () => {
    const err = new ClaudeCodeProviderError('timeout', 'TIMEOUT', 'Try again.');
    expect(err.recoverable).toBe(false);
  });

  it('supports recoverable errors', () => {
    const err = new ClaudeCodeProviderError('rate limited', 'RATE_LIMITED', 'Wait and retry.', true);
    expect(err.recoverable).toBe(true);
  });

  it('preserves details', () => {
    const details = { exitCode: 1, stderr: 'auth failed' };
    const err = new ClaudeCodeProviderError('crash', 'CRASHED', 'Check logs.', true, details);
    expect(err.details).toEqual(details);
  });
});
