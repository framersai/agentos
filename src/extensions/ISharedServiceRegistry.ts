/**
 * Cleanup and discovery metadata for a shared service.
 */
export interface SharedServiceOptions {
  /**
   * Cleanup callback invoked when the service is released.
   */
  dispose?: (instance: unknown) => Promise<void> | void;
  /**
   * Optional tags describing the service for diagnostics or tooling.
   */
  tags?: string[];
}

/**
 * Registry for sharing heavyweight service instances across extensions.
 */
export interface ISharedServiceRegistry {
  /**
   * Return an existing service or lazily create it once.
   */
  getOrCreate<T>(
    serviceId: string,
    factory: () => Promise<T> | T,
    options?: SharedServiceOptions,
  ): Promise<T>;

  /**
   * Return true when a service has already been initialized.
   */
  has(serviceId: string): boolean;

  /**
   * Dispose a specific service if it exists.
   */
  release(serviceId: string): Promise<void>;

  /**
   * Dispose all registered services.
   */
  releaseAll(): Promise<void>;
}
