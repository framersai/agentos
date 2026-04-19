/**
 * @fileoverview Emergent Capability Engine — public API barrel.
 * @module @framers/agentos/emergent
 *
 * Re-exports all types, interfaces, and constants from the emergent module.
 * Import from this barrel to avoid deep path coupling to internal files.
 *
 * @example
 * ```ts
 * import type { EmergentTool, ForgeToolRequest, DEFAULT_EMERGENT_CONFIG } from '../emergent/index.js';
 * ```
 */
export * from './types.js';
export { DEFAULT_SELF_IMPROVEMENT_CONFIG } from './SelfImprovementConfig.js';
export { ComposableToolBuilder } from './ComposableToolBuilder.js';
export { SandboxedToolForge } from './SandboxedToolForge.js';
export { EmergentToolRegistry } from './EmergentToolRegistry.js';
export { EMERGENT_TOOL_PACKAGE_SCHEMA_VERSION, buildEmergentToolPackage, serializeEmergentToolPackage, parseEmergentToolPackage, materializeEmergentToolFromPackage, } from './ToolPackage.js';
export { EmergentJudge } from './EmergentJudge.js';
export { EmergentCapabilityEngine } from './EmergentCapabilityEngine.js';
export { ForgeToolMetaTool } from './ForgeToolMetaTool.js';
export { exportToolAsSkill, buildCapabilityYaml, writeSkillFile, exportToolAsSkillPack, } from './SkillExporter.js';
export { AdaptPersonalityTool } from './AdaptPersonalityTool.js';
export { ManageSkillsTool } from './ManageSkillsTool.js';
export { CreateWorkflowTool } from './CreateWorkflowTool.js';
export { SelfEvaluateTool } from './SelfEvaluateTool.js';
export { PersonalityMutationStore } from './PersonalityMutationStore.js';
// Forge observability — instrumentation for consumers that want live
// visibility into forge health (rejection-reason histogram, shape-check
// pre-validator, schema inference from testCases, capture wrapper,
// aggregator).
export { classifyForgeRejection, } from './ForgeRejectionClassifier.js';
export { validateForgeShape, } from './ForgeShapeValidator.js';
export { inferSchemaFromTestCases, } from './ForgeSchemaInference.js';
export { wrapForgeTool, } from './wrapForgeTool.js';
export { ForgeStatsAggregator, emptyForgeStats, } from './ForgeStatsAggregator.js';
//# sourceMappingURL=index.js.map