import type { UserContext } from '../../cognitive_substrate/IGMI';
import type { ToolDefinitionForLLM } from '../../core/tools/IToolOrchestrator';
import type { IToolOrchestrator } from '../../core/tools/IToolOrchestrator';
import type { ToolExecutionContext, ToolExecutionResult, ITool, JSONSchemaObject } from '../../core/tools/ITool';
import type { AgentOSExternalToolHandlerResult } from './processRequestWithExternalTools';
export type ExternalToolExecutor<TArgs extends Record<string, any> = Record<string, any>, TOutput = unknown> = (args: TArgs, context: ToolExecutionContext) => Promise<ToolExecutionResult<TOutput>>;
type ExternalToolPromptMetadata = Partial<Pick<ITool<Record<string, any>, unknown>, 'name' | 'displayName' | 'description' | 'inputSchema' | 'outputSchema' | 'requiredCapabilities' | 'category' | 'version' | 'hasSideEffects'>>;
export type ExternalToolRegistryEntry = ExternalToolExecutor | (Pick<ITool<Record<string, any>, unknown>, 'execute'> & ExternalToolPromptMetadata);
export type NamedExternalToolRegistryEntry = Pick<ITool<Record<string, any>, unknown>, 'name' | 'execute'> & ExternalToolPromptMetadata;
export type ExternalToolRegistry = ReadonlyMap<string, ExternalToolRegistryEntry> | Record<string, ExternalToolRegistryEntry> | Iterable<NamedExternalToolRegistryEntry>;
export type NormalizedExternalToolRegistry = ReadonlyMap<string, ExternalToolRegistryEntry>;
export type PromptAwareExternalToolRegistryEntry = {
    name: string;
    execute: ITool<Record<string, any>, unknown>['execute'];
    description: string;
    inputSchema: JSONSchemaObject;
    displayName?: string;
    outputSchema?: JSONSchemaObject;
    requiredCapabilities?: string[];
    category?: string;
    version?: string;
    hasSideEffects?: boolean;
};
export interface OpenAIFunctionToolSchema {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: JSONSchemaObject;
    };
}
export declare function normalizeOptionalString(value: unknown): string | undefined;
export declare function buildScopedExternalToolContextParts(input: {
    userId: string;
    organizationId?: string;
    sessionId?: string;
    conversationId?: string;
    userContext?: Record<string, unknown>;
}): {
    userContext: UserContext;
    sessionData: Record<string, unknown>;
};
export declare function normalizeExternalToolRegistry(registry: ExternalToolRegistry | undefined): NormalizedExternalToolRegistry | undefined;
export declare function mergeExternalToolRegistries(...registries: Array<ExternalToolRegistry | undefined>): NormalizedExternalToolRegistry | undefined;
export declare function listPromptAwareExternalTools(registry: ExternalToolRegistry | undefined): PromptAwareExternalToolRegistryEntry[];
export declare function listExternalToolDefinitionsForLLM(registry: ExternalToolRegistry | undefined): ToolDefinitionForLLM[];
export declare function formatToolDefinitionsForOpenAI(definitions: ReadonlyArray<ToolDefinitionForLLM>): OpenAIFunctionToolSchema[];
export declare function formatExternalToolsForOpenAI(registry: ExternalToolRegistry | undefined): OpenAIFunctionToolSchema[];
export declare function createExternalToolProxyTool(entry: PromptAwareExternalToolRegistryEntry): ITool<Record<string, any>, unknown>;
export declare function registerTemporaryExternalTools(toolOrchestrator: Pick<IToolOrchestrator, 'getTool' | 'registerTool' | 'unregisterTool'>, registry: ExternalToolRegistry | undefined): Promise<() => Promise<void>>;
export declare function executeExternalToolFromRegistry(registry: ExternalToolRegistry | undefined, toolName: string, args: Record<string, any>, context: ToolExecutionContext, options: {
    errorOrigin: string;
    failureMessage: string;
}): Promise<AgentOSExternalToolHandlerResult | undefined>;
export {};
//# sourceMappingURL=externalToolRegistry.d.ts.map