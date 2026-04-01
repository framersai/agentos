/**
 * @file MissionExpansionHandler.ts
 * @description Mission-specific graph expansion adapter for GraphRuntime.
 *
 * Converts tool-originated expansion requests into GraphPatch proposals, applies
 * autonomy/guardrail gating, and emits mission events when a patch is approved.
 */
import type { NodeLlmConfig } from '../ir/types.js';
import type { GraphExpansionHandler } from '../runtime/GraphRuntime.js';
import type { AutonomyMode, GuardrailThresholds, ProviderStrategyConfig } from './types.js';
export interface CreateMissionExpansionHandlerOptions {
    autonomy: AutonomyMode;
    thresholds: GuardrailThresholds;
    llmCaller: (system: string, user: string) => Promise<string>;
    costCap: number;
    maxAgents: number;
    availableTools?: Array<{
        name: string;
        description: string;
    }>;
    availableProviders?: string[];
    providerStrategy?: ProviderStrategyConfig;
    defaultLlm?: NodeLlmConfig;
    initialEstimatedCost?: number;
    initialExpansions?: number;
    initialToolForges?: number;
}
export declare function createMissionExpansionHandler(options: CreateMissionExpansionHandlerOptions): GraphExpansionHandler;
//# sourceMappingURL=MissionExpansionHandler.d.ts.map