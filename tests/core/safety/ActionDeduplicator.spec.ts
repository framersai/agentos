import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ActionDeduplicator } from '../../../src/core/safety/ActionDeduplicator';

describe('ActionDeduplicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first action is not duplicate', () => {
    const dedup = new ActionDeduplicator();
    expect(dedup.isDuplicate('action-1')).toBe(false);
  });

  it('second action IS duplicate within window', () => {
    const dedup = new ActionDeduplicator();
    dedup.record('action-1');
    expect(dedup.isDuplicate('action-1')).toBe(true);
  });

  it('action expires after windowMs', () => {
    const dedup = new ActionDeduplicator({ windowMs: 5_000 });
    dedup.record('action-1');
    expect(dedup.isDuplicate('action-1')).toBe(true);

    vi.advanceTimersByTime(6_000);
    expect(dedup.isDuplicate('action-1')).toBe(false);
  });

  it('record() returns entry with count', () => {
    const dedup = new ActionDeduplicator();
    const first = dedup.record('action-1');
    expect(first.count).toBe(1);
    expect(first.key).toBe('action-1');

    const second = dedup.record('action-1');
    expect(second.count).toBe(2);

    const third = dedup.record('action-1');
    expect(third.count).toBe(3);
  });

  it('checkAndRecord() combines both', () => {
    const dedup = new ActionDeduplicator();

    const first = dedup.checkAndRecord('action-1');
    expect(first.isDuplicate).toBe(false);
    expect(first.entry.count).toBe(1);

    const second = dedup.checkAndRecord('action-1');
    expect(second.isDuplicate).toBe(true);
    expect(second.entry.count).toBe(2);
  });

  it('LRU eviction at maxEntries', () => {
    const dedup = new ActionDeduplicator({ maxEntries: 3 });

    dedup.record('a');
    dedup.record('b');
    dedup.record('c');
    expect(dedup.size).toBe(3);

    // Adding a 4th should evict the oldest ('a')
    dedup.record('d');
    expect(dedup.size).toBe(3);
    expect(dedup.isDuplicate('a')).toBe(false);
    expect(dedup.isDuplicate('b')).toBe(true);
    expect(dedup.isDuplicate('c')).toBe(true);
    expect(dedup.isDuplicate('d')).toBe(true);
  });

  it('cleanup() removes expired entries', () => {
    const dedup = new ActionDeduplicator({ windowMs: 5_000 });

    dedup.record('a');
    dedup.record('b');
    expect(dedup.size).toBe(2);

    vi.advanceTimersByTime(6_000);
    const removed = dedup.cleanup();
    expect(removed).toBe(2);
    expect(dedup.size).toBe(0);
  });

  it('clear() resets everything', () => {
    const dedup = new ActionDeduplicator();
    dedup.record('a');
    dedup.record('b');
    dedup.record('c');
    expect(dedup.size).toBe(3);

    dedup.clear();
    expect(dedup.size).toBe(0);
  });

  it('custom windowMs works', () => {
    const dedup = new ActionDeduplicator({ windowMs: 500 });
    dedup.record('fast');
    expect(dedup.isDuplicate('fast')).toBe(true);

    vi.advanceTimersByTime(501);
    expect(dedup.isDuplicate('fast')).toBe(false);
  });
});
