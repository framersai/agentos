import type { ISharedServiceRegistry, SharedServiceOptions } from './ISharedServiceRegistry';
/**
 * Thread-safe shared-service registry for extension lifecycle context.
 */
export declare class SharedServiceRegistry implements ISharedServiceRegistry {
    private readonly instances;
    private readonly pending;
    private readonly disposers;
    private readonly tagMap;
    getOrCreate<T>(serviceId: string, factory: () => Promise<T> | T, options?: SharedServiceOptions): Promise<T>;
    has(serviceId: string): boolean;
    release(serviceId: string): Promise<void>;
    releaseAll(): Promise<void>;
}
//# sourceMappingURL=SharedServiceRegistry.d.ts.map