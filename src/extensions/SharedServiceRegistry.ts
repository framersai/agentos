import type { ISharedServiceRegistry, SharedServiceOptions } from './ISharedServiceRegistry';

/**
 * Thread-safe shared-service registry for extension lifecycle context.
 */
export class SharedServiceRegistry implements ISharedServiceRegistry {
  private readonly instances = new Map<string, unknown>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly disposers = new Map<string, (instance: unknown) => Promise<void> | void>();
  private readonly tagMap = new Map<string, string[]>();

  public async getOrCreate<T>(
    serviceId: string,
    factory: () => Promise<T> | T,
    options?: SharedServiceOptions,
  ): Promise<T> {
    if (this.instances.has(serviceId)) {
      return this.instances.get(serviceId) as T;
    }

    const existing = this.pending.get(serviceId);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = Promise.resolve(factory())
      .then((instance) => {
        this.instances.set(serviceId, instance);
        this.pending.delete(serviceId);

        if (options?.dispose) {
          this.disposers.set(serviceId, options.dispose);
        }
        if (options?.tags) {
          this.tagMap.set(serviceId, [...options.tags]);
        }

        return instance;
      })
      .catch((error) => {
        this.pending.delete(serviceId);
        throw error;
      });

    this.pending.set(serviceId, promise as Promise<unknown>);
    return promise;
  }

  public has(serviceId: string): boolean {
    return this.instances.has(serviceId);
  }

  public async release(serviceId: string): Promise<void> {
    const pending = this.pending.get(serviceId);
    if (pending) {
      await Promise.allSettled([pending]);
    }

    const instance = this.instances.get(serviceId);
    if (instance === undefined) {
      return;
    }

    const disposer = this.disposers.get(serviceId);
    if (disposer) {
      await Promise.resolve(disposer(instance));
    }

    this.instances.delete(serviceId);
    this.disposers.delete(serviceId);
    this.tagMap.delete(serviceId);
  }

  public async releaseAll(): Promise<void> {
    await Promise.allSettled([...this.pending.values()]);
    await Promise.allSettled([...this.instances.keys()].map((serviceId) => this.release(serviceId)));
  }
}
