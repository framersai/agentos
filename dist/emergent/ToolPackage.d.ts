/**
 * @fileoverview Portable export/import helpers for emergent tools.
 * @module @framers/agentos/emergent/ToolPackage
 */
import type { EmergentTool, ToolTier, ToolUsageStats, ComposableToolSpec, SandboxAPI, CreationVerdict, PromotionVerdict } from './types.js';
import type { JSONSchemaObject } from '../core/tools/ITool.js';
export declare const EMERGENT_TOOL_PACKAGE_SCHEMA_VERSION: "agentos.emergent-tool.v1";
export interface PortableSandboxImplementation {
    mode: 'sandbox';
    allowlist: SandboxAPI[];
    sourcePersisted: boolean;
    redactedAtRest: boolean;
    code?: string;
}
export type PortableToolImplementation = ComposableToolSpec | PortableSandboxImplementation;
export interface EmergentToolPackageManifest {
    schemaVersion: typeof EMERGENT_TOOL_PACKAGE_SCHEMA_VERSION;
    packageType: 'emergent-tool';
    exportedAt: string;
    portability: {
        portable: boolean;
        warnings: string[];
    };
    tool: {
        originalToolId: string;
        originalTier: ToolTier;
        name: string;
        description: string;
        inputSchema: JSONSchemaObject;
        outputSchema: JSONSchemaObject;
        implementation: PortableToolImplementation;
        createdBy: string;
        createdAt: string;
        source: string;
        judgeVerdicts: Array<CreationVerdict | PromotionVerdict>;
        usageStats: ToolUsageStats;
    };
}
export interface BuildEmergentToolPackageOptions {
    exportedAt?: string;
    includeJudgeVerdicts?: boolean;
    includeUsageStats?: boolean;
}
export interface MaterializeEmergentToolFromPackageOptions {
    createdBy: string;
    tier?: ToolTier;
    toolId?: string;
    toolName?: string;
    createdAt?: string;
    preserveJudgeVerdicts?: boolean;
    preserveUsageStats?: boolean;
}
export declare function buildEmergentToolPackage(tool: EmergentTool, options?: BuildEmergentToolPackageOptions): EmergentToolPackageManifest;
export declare function serializeEmergentToolPackage(manifest: EmergentToolPackageManifest, format?: 'yaml' | 'json'): string;
export declare function parseEmergentToolPackage(raw: string): EmergentToolPackageManifest;
export declare function materializeEmergentToolFromPackage(manifest: EmergentToolPackageManifest, options: MaterializeEmergentToolFromPackageOptions): EmergentTool;
//# sourceMappingURL=ToolPackage.d.ts.map