/**
 * @fileoverview Extension registration for the standalone SQLite-first
 * `Memory` facade.
 *
 * This exposes the facade through the generic `memory-provider` extension kind
 * so hosts can treat it like any other pluggable memory backend.
 *
 * @module agentos/memory/extension/StandaloneMemoryExtension
 */
import { type MemoryProviderPayload, type MemoryProviderDescriptor } from '../../../extensions/types.js';
export interface StandaloneMemoryDescriptorOptions {
    /**
     * When true, the descriptor's `shutdown()` will close the configured
     * `Memory` instance.
     * @default false
     */
    manageLifecycle?: boolean;
    /**
     * Optional payload overrides.
     */
    overrides?: Partial<MemoryProviderPayload>;
}
/**
 * Create a `memory-provider` descriptor for the standalone `Memory` facade.
 */
export declare function createStandaloneMemoryDescriptor(options?: StandaloneMemoryDescriptorOptions): MemoryProviderDescriptor;
//# sourceMappingURL=StandaloneMemoryExtension.d.ts.map