import type { CapabilityDiscoveryResult } from '../../discovery/types.js';
import type { AgentOSInput } from '../types/AgentOSInput.js';
export type SelfImprovementSkillDescriptor = {
    skillId: string;
    name: string;
    category: string;
    description?: string;
    content?: string;
    sourcePath?: string;
};
export type SelfImprovementSessionRuntimeState = {
    modelOptions: Record<string, unknown>;
    userPreferences: Record<string, unknown>;
    enabledSkills: Map<string, SelfImprovementSkillDescriptor>;
    disabledSkillIds: Set<string>;
};
export declare function buildSelfImprovementSessionRuntimeKey(sessionId: string): string;
export declare function getSelfImprovementSessionRuntimeState(store: Map<string, SelfImprovementSessionRuntimeState>, sessionKey: string, createIfMissing?: boolean): SelfImprovementSessionRuntimeState;
export declare function getSelfImprovementRuntimeParam(store: Map<string, SelfImprovementSessionRuntimeState>, sessionKey: string, param: string): unknown;
export declare function setSelfImprovementRuntimeParam(store: Map<string, SelfImprovementSessionRuntimeState>, sessionKey: string, param: string, value: unknown): void;
export declare function applySelfImprovementSessionOverrides(store: Map<string, SelfImprovementSessionRuntimeState>, input: AgentOSInput): AgentOSInput;
export declare function enableSelfImprovementSessionSkill(store: Map<string, SelfImprovementSessionRuntimeState>, sessionKey: string, skill: SelfImprovementSkillDescriptor): void;
export declare function disableSelfImprovementSessionSkill(store: Map<string, SelfImprovementSessionRuntimeState>, sessionKey: string, skillId: string): void;
export declare function listSelfImprovementSessionSkills(store: Map<string, SelfImprovementSessionRuntimeState>, sessionKey: string): SelfImprovementSkillDescriptor[];
export declare function listSelfImprovementDisabledSkillIds(store: Map<string, SelfImprovementSessionRuntimeState>, sessionKey: string): string[];
export declare function filterCapabilityDiscoveryResultByDisabledSkills(result: CapabilityDiscoveryResult, disabledSkillIds: string[]): CapabilityDiscoveryResult;
export declare function buildSelfImprovementSkillPromptContext(store: Map<string, SelfImprovementSessionRuntimeState>, sessionKey: string): string | undefined;
//# sourceMappingURL=selfImprovementRuntime.d.ts.map