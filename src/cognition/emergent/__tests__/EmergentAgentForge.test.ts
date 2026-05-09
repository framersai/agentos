/**
 * @fileoverview Tests for EmergentAgentForge — the runtime synthesizer
 * that produces a BaseAgentConfig from a manager-supplied spec.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EmergentAgentForge, type AgentSpec } from '../EmergentAgentForge.js';

describe('EmergentAgentForge', () => {
  let forge: EmergentAgentForge;

  beforeEach(() => {
    forge = new EmergentAgentForge({
      defaultModel: 'gpt-4o',
      defaultProvider: 'openai',
    });
  });

  it('forges a BaseAgentConfig from a minimal spec', async () => {
    const spec: AgentSpec = {
      role: 'fact_checker',
      instructions: 'Verify claims against the cited sources.',
    };

    const result = await forge.forge(spec);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.instructions).toBe(spec.instructions);
    expect(result.config.model).toBe('gpt-4o');
    expect(result.config.provider).toBe('openai');
    expect(result.config.name).toBe('fact_checker');
  });

  it('inherits memory and guardrails from agency-level defaults when provided', async () => {
    const spec: AgentSpec = {
      role: 'fact_checker',
      instructions: 'Verify claims.',
    };

    const result = await forge.forge(spec, {
      memory: true,
      guardrails: ['pii-redaction'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.memory).toBe(true);
    expect(result.config.guardrails).toEqual(['pii-redaction']);
  });

  it('rejects specs with empty instructions', async () => {
    const spec: AgentSpec = {
      role: 'fact_checker',
      instructions: '',
    };

    const result = await forge.forge(spec);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/instructions/i);
  });

  it('rejects specs with role names that collide with reserved tool names', async () => {
    const spec: AgentSpec = {
      role: 'spawn_specialist',
      instructions: 'Some specialist.',
    };

    const result = await forge.forge(spec);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/reserved/i);
  });

  it('rejects specs whose role name is not a valid identifier', async () => {
    const spec: AgentSpec = {
      role: 'fact checker with spaces',
      instructions: 'Verify claims.',
    };

    const result = await forge.forge(spec);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/identifier|invalid/i);
  });

  it('truncates instructions to a configured cap', async () => {
    const longInstructions = 'A'.repeat(50_000);
    const customForge = new EmergentAgentForge({
      defaultModel: 'gpt-4o',
      defaultProvider: 'openai',
      maxInstructionsLength: 1024,
    });

    const result = await customForge.forge({
      role: 'verbose_agent',
      instructions: longInstructions,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.instructions!.length).toBeLessThanOrEqual(1024);
  });

  it('respects spec-level model and provider overrides', async () => {
    const spec: AgentSpec = {
      role: 'haiku_specialist',
      instructions: 'Be concise.',
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
    };

    const result = await forge.forge(spec);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.model).toBe('claude-haiku-4-5-20251001');
    expect(result.config.provider).toBe('anthropic');
  });
});
