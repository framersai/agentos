/**
 * @fileoverview Emergent Capability Engine — public API barrel.
 * @module @framers/agentos/emergent
 *
 * Re-exports all types, interfaces, and constants from the emergent module.
 * Import from this barrel to avoid deep path coupling to internal files.
 *
 * @example
 * ```ts
 * import type { EmergentTool, ForgeToolRequest, DEFAULT_EMERGENT_CONFIG } from '@framers/agentos/emergent';
 * ```
 */

export * from './types.js';
export { ComposableToolBuilder } from './ComposableToolBuilder.js';
export { SandboxedToolForge } from './SandboxedToolForge.js';
export { EmergentToolRegistry } from './EmergentToolRegistry.js';
export type { IStorageAdapter, AuditEntry } from './EmergentToolRegistry.js';
