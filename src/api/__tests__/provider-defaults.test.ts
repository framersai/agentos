import { describe, it, expect, afterEach } from 'vitest';
import { PROVIDER_DEFAULTS, autoDetectProvider } from '../provider-defaults.js';
import { resolveModelOption } from '../model.js';

describe('PROVIDER_DEFAULTS', () => {
  it('has text model for all major providers', () => {
    for (const id of ['openai', 'anthropic', 'ollama', 'openrouter', 'gemini']) {
      expect(PROVIDER_DEFAULTS[id]?.text).toBeDefined();
    }
  });

  it('has image model for image providers', () => {
    for (const id of ['openai', 'stability', 'replicate', 'ollama']) {
      expect(PROVIDER_DEFAULTS[id]?.image).toBeDefined();
    }
  });
});

describe('autoDetectProvider', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    // Restore env after each test
    for (const key of [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENROUTER_API_KEY',
      'GEMINI_API_KEY',
      'OLLAMA_BASE_URL',
      'STABILITY_API_KEY',
      'REPLICATE_API_TOKEN',
    ]) {
      if (origEnv[key] !== undefined) {
        process.env[key] = origEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('detects openai from OPENAI_API_KEY', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.OPENAI_API_KEY = 'test';
    expect(autoDetectProvider()).toBe('openai');
  });

  it('detects anthropic from ANTHROPIC_API_KEY', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test';
    expect(autoDetectProvider()).toBe('anthropic');
  });

  it('returns undefined when no keys set', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.STABILITY_API_KEY;
    delete process.env.REPLICATE_API_TOKEN;
    expect(autoDetectProvider()).toBeUndefined();
  });
});

describe('resolveModelOption', () => {
  it('resolves provider-only to default text model', () => {
    const result = resolveModelOption({ provider: 'openai' }, 'text');
    expect(result).toEqual({ providerId: 'openai', modelId: 'gpt-4o' });
  });

  it('resolves provider + explicit model override', () => {
    const result = resolveModelOption({ provider: 'openai', model: 'gpt-4o-mini' }, 'text');
    expect(result).toEqual({ providerId: 'openai', modelId: 'gpt-4o-mini' });
  });

  it('resolves legacy model string (backwards compat)', () => {
    const result = resolveModelOption({ model: 'openai:gpt-4o-mini' }, 'text');
    expect(result).toEqual({ providerId: 'openai', modelId: 'gpt-4o-mini' });
  });

  it('resolves provider-only for image task', () => {
    const result = resolveModelOption({ provider: 'stability' }, 'image');
    expect(result).toEqual({ providerId: 'stability', modelId: 'stable-diffusion-xl-1024-v1-0' });
  });

  it('throws for unknown provider', () => {
    expect(() => resolveModelOption({ provider: 'nonexistent' }, 'text')).toThrow(/unknown provider/i);
  });

  it('throws for provider without matching task model', () => {
    expect(() => resolveModelOption({ provider: 'stability' }, 'text')).toThrow(/no default text model/i);
  });

  it('throws when neither provider nor model given and no env', () => {
    const saved: Record<string, string | undefined> = {};
    const keys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'OLLAMA_BASE_URL'];
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      expect(() => resolveModelOption({}, 'text')).toThrow(/required/i);
    } finally {
      for (const k of keys) {
        if (saved[k] !== undefined) process.env[k] = saved[k];
      }
    }
  });
});
