/**
 * @fileoverview Default configuration constants and resolver for cognitive mechanisms.
 *
 * All mechanisms default to enabled with empirically-grounded constants.
 * The `resolveConfig()` function deep-merges partial user overrides with defaults.
 *
 * @module agentos/memory/mechanisms/defaults
 */
import type { CognitiveMechanismsConfig, ResolvedMechanismsConfig } from './types.js';
/** Full default config with all mechanisms enabled and sensible constants. */
export declare const DEFAULT_MECHANISMS_CONFIG: ResolvedMechanismsConfig;
/**
 * Deep-merge partial user config with defaults.
 *
 * Each mechanism's partial fields are spread over the default,
 * preserving any user overrides while filling in missing values.
 */
export declare function resolveConfig(partial: CognitiveMechanismsConfig): ResolvedMechanismsConfig;
//# sourceMappingURL=defaults.d.ts.map