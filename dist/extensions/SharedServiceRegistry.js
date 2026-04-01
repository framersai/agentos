/**
 * Thread-safe shared-service registry for extension lifecycle context.
 */
export class SharedServiceRegistry {
    constructor() {
        this.instances = new Map();
        this.pending = new Map();
        this.disposers = new Map();
        this.tagMap = new Map();
    }
    async getOrCreate(serviceId, factory, options) {
        if (this.instances.has(serviceId)) {
            return this.instances.get(serviceId);
        }
        const existing = this.pending.get(serviceId);
        if (existing) {
            return existing;
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
        this.pending.set(serviceId, promise);
        return promise;
    }
    has(serviceId) {
        return this.instances.has(serviceId);
    }
    async release(serviceId) {
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
    async releaseAll() {
        await Promise.allSettled([...this.pending.values()]);
        await Promise.allSettled([...this.instances.keys()].map((serviceId) => this.release(serviceId)));
    }
}
//# sourceMappingURL=SharedServiceRegistry.js.map