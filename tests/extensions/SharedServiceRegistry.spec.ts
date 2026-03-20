import { describe, expect, it, vi } from 'vitest';

import { SharedServiceRegistry } from '../../src/extensions/SharedServiceRegistry';

describe('SharedServiceRegistry', () => {
  it('coalesces concurrent getOrCreate calls', async () => {
    const registry = new SharedServiceRegistry();
    const factory = vi.fn(async () => ({ name: 'shared' }));

    const [first, second] = await Promise.all([
      registry.getOrCreate('agentos:test:service', factory),
      registry.getOrCreate('agentos:test:service', factory),
    ]);

    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(registry.has('agentos:test:service')).toBe(true);
  });

  it('cleans pending promises after factory failures so callers can retry', async () => {
    const registry = new SharedServiceRegistry();
    const failure = new Error('factory failed');
    const factory = vi
      .fn<[], Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ ok: true });

    await expect(registry.getOrCreate('agentos:test:retryable', factory)).rejects.toThrow(
      'factory failed',
    );
    await expect(registry.getOrCreate('agentos:test:retryable', factory)).resolves.toEqual({
      ok: true,
    });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('releases a service with its disposer', async () => {
    const registry = new SharedServiceRegistry();
    const disposer = vi.fn(async () => {});
    const instance = { ok: true };

    await registry.getOrCreate('agentos:test:disposable', () => instance, {
      dispose: disposer,
      tags: ['test'],
    });
    await registry.release('agentos:test:disposable');

    expect(disposer).toHaveBeenCalledWith(instance);
    expect(registry.has('agentos:test:disposable')).toBe(false);
  });

  it('releases all initialized services', async () => {
    const registry = new SharedServiceRegistry();
    const disposerA = vi.fn(async () => {});
    const disposerB = vi.fn(async () => {});

    await registry.getOrCreate('agentos:test:a', async () => ({ id: 'a' }), { dispose: disposerA });
    await registry.getOrCreate('agentos:test:b', async () => ({ id: 'b' }), { dispose: disposerB });
    await registry.releaseAll();

    expect(disposerA).toHaveBeenCalledTimes(1);
    expect(disposerB).toHaveBeenCalledTimes(1);
    expect(registry.has('agentos:test:a')).toBe(false);
    expect(registry.has('agentos:test:b')).toBe(false);
  });
});
