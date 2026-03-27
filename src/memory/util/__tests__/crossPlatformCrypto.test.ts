import { describe, it, expect } from 'vitest';
import { sha256, uuid } from '../crossPlatformCrypto.js';

describe('sha256', () => {
  it('returns a 64-char hex string', async () => {
    const hash = await sha256('hello world');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', async () => {
    const h1 = await sha256('test');
    const h2 = await sha256('test');
    expect(h1).toBe(h2);
  });

  it('produces correct known hash', async () => {
    const hash = await sha256('hello world');
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });
});

describe('uuid', () => {
  it('returns a string in UUID format', () => {
    const id = uuid();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuid()));
    expect(ids.size).toBe(100);
  });
});
