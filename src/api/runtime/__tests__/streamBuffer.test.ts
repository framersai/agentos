import { describe, expect, it } from 'vitest';

import { createBufferedAsyncReplay } from '../streamBuffer.js';

describe('createBufferedAsyncReplay', () => {
  it('replays buffered items to late consumers while preserving live delivery', async () => {
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const replay = createBufferedAsyncReplay((async function* () {
      yield 'first';
      await secondGate;
      yield 'second';
    })());

    const early = replay.iterable[Symbol.asyncIterator]();
    await expect(early.next()).resolves.toEqual({ value: 'first', done: false });

    const late = replay.iterable[Symbol.asyncIterator]();
    await expect(late.next()).resolves.toEqual({ value: 'first', done: false });

    releaseSecond();

    await expect(early.next()).resolves.toEqual({ value: 'second', done: false });
    await expect(late.next()).resolves.toEqual({ value: 'second', done: false });
    await expect(early.next()).resolves.toEqual({ value: undefined, done: true });
    await expect(late.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it('stores buffered items after draining completes', async () => {
    const replay = createBufferedAsyncReplay((async function* () {
      yield 'a';
      yield 'b';
      yield 'c';
    })());

    await replay.ensureDraining();
    expect(replay.getBuffered()).toEqual(['a', 'b', 'c']);
  });

  it('propagates source errors to consumers and ensureDraining', async () => {
    const replay = createBufferedAsyncReplay((async function* () {
      yield 'ok';
      throw new Error('boom');
    })());

    const iterator = replay.iterable[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ value: 'ok', done: false });
    await expect(iterator.next()).rejects.toThrow('boom');
    await expect(replay.ensureDraining()).rejects.toThrow('boom');
  });
});
