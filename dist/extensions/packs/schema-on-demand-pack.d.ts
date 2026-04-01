/**
 * @file schema-on-demand-pack.ts
 * @description ExtensionPack that exposes "schema-on-demand" meta tools for
 * enabling extension packs at runtime. This supports "lazy tool schemas":
 * start with a small toolset (this pack), then dynamically load additional
 * packs when the model requests them.
 *
 * @module AgentOS/Extensions/Packs
 */
import type { ExtensionPack } from '../manifest.js';
import type { ExtensionManager } from '../ExtensionManager.js';
export interface SchemaOnDemandPackOptions {
    /**
     * When true, allow enabling packs via `source='package'`.
     *
     * Default: true in non-production, false in production.
     *
     * Note: when `officialRegistryOnly` is enabled (default), package names must
     * still be present in the installed `@framers/agentos-extensions-registry` catalog.
     */
    allowPackages?: boolean;
    /**
     * When true, allow enabling packs via `source='module'` with a local module specifier/path.
     *
     * Default: false.
     */
    allowModules?: boolean;
    /**
     * When true, only allow loading extension packs present in the official
     * `@framers/agentos-extensions-registry` catalog.
     *
     * This blocks arbitrary npm imports (typosquatting/supply-chain).
     *
     * Default: true.
     */
    officialRegistryOnly?: boolean;
}
/**
 * Create an ExtensionPack that adds schema-on-demand tools:
 * - `extensions_list`
 * - `extensions_enable`
 * - `extensions_status`
 */
export declare function createSchemaOnDemandPack(opts: {
    extensionManager: ExtensionManager;
    options?: SchemaOnDemandPackOptions;
}): ExtensionPack;
//# sourceMappingURL=schema-on-demand-pack.d.ts.map