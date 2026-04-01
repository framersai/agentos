export interface AgentOSUsageLedgerOptions {
    /** Enable persistence using the shared default path under `~/.framers/usage-ledger.jsonl`. */
    enabled?: boolean;
    /** Explicit path to the append-only JSONL ledger file. */
    path?: string;
    /** Session identifier used to group related helper calls. Defaults to `"global"`. */
    sessionId?: string;
    /** Optional persona identifier for callers layering persona-specific usage views. */
    personaId?: string;
    /** Optional source label such as `"generateText"` or `"agent.session.stream"`. */
    source?: string;
}
export interface AgentOSUsageEvent {
    recordedAt: string;
    sessionId: string;
    personaId?: string;
    providerId?: string;
    modelId?: string;
    userId?: string;
    tenantId?: string;
    source?: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUSD?: number;
}
export interface AgentOSUsageAggregate {
    sessionId?: string;
    personaId?: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUSD: number;
    calls: number;
}
export interface AgentOSUsageRecordInput {
    providerId?: string;
    modelId?: string;
    userId?: string;
    tenantId?: string;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        costUSD?: number;
    };
    options?: AgentOSUsageLedgerOptions;
}
interface ReadAgentOSUsageOptions extends Pick<AgentOSUsageLedgerOptions, 'enabled' | 'path' | 'sessionId' | 'personaId'> {
}
export declare function getDefaultAgentOSUsageLedgerPath(): string;
export declare function resolveAgentOSUsageLedgerPath(options?: Pick<AgentOSUsageLedgerOptions, 'enabled' | 'path'>): string | undefined;
export declare function readRecordedAgentOSUsageEvents(options?: ReadAgentOSUsageOptions): Promise<AgentOSUsageEvent[]>;
export declare function recordAgentOSUsage(input: AgentOSUsageRecordInput): Promise<boolean>;
export declare function getRecordedAgentOSUsage(options?: ReadAgentOSUsageOptions): Promise<AgentOSUsageAggregate>;
export declare function clearRecordedAgentOSUsage(options?: Pick<AgentOSUsageLedgerOptions, 'enabled' | 'path'>): Promise<void>;
export {};
//# sourceMappingURL=usageLedger.d.ts.map