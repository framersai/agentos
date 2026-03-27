/**
 * @file streamBuffer.ts
 * Small helper for replayable async streams.
 *
 * Some AgentOS streaming surfaces need to support:
 * - live iteration of an underlying async iterable
 * - multiple consumers (`fullStream`, `textStream`, promises)
 * - post-run aggregation after the stream completes
 *
 * This helper drains the source exactly once, buffers yielded parts, and lets
 * any number of iterators replay buffered items while still receiving new items
 * as they arrive.
 */

export type BufferedAsyncReplay<T> = {
  iterable: AsyncIterable<T>;
  ensureDraining: () => Promise<void>;
  getBuffered: () => readonly T[];
};

export function createBufferedAsyncReplay<T>(
  source: AsyncIterable<T>,
): BufferedAsyncReplay<T> {
  const buffered: T[] = [];
  let done = false;
  let failure: unknown;
  let drainPromise: Promise<void> | null = null;
  let waiters: Array<() => void> = [];

  const notify = (): void => {
    const pending = waiters;
    waiters = [];
    for (const wake of pending) {
      wake();
    }
  };

  const ensureDraining = (): Promise<void> => {
    if (!drainPromise) {
      drainPromise = (async () => {
        try {
          for await (const item of source) {
            buffered.push(item);
            notify();
          }
        } catch (error) {
          failure = error;
          notify();
          throw error;
        } finally {
          done = true;
          notify();
        }
      })();
    }

    return drainPromise;
  };

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      let index = 0;
      void ensureDraining();

      return {
        async next(): Promise<IteratorResult<T>> {
          while (true) {
            if (index < buffered.length) {
              const value = buffered[index];
              index += 1;
              return { value, done: false };
            }

            if (done) {
              if (failure !== undefined) {
                throw failure;
              }
              return { value: undefined, done: true };
            }

            await new Promise<void>((resolve) => {
              waiters.push(resolve);
            });
          }
        },
      };
    },
  };

  return {
    iterable,
    ensureDraining,
    getBuffered: () => buffered,
  };
}
