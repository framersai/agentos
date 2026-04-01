/**
 * @file CostGuard.ts
 * @description In-process spending caps per agent session/day.
 * Complements the backend CostService (which handles billing persistence)
 * by enforcing hard limits that halt execution immediately.
 */
export type CostCapType = 'session' | 'daily' | 'single_operation';
export interface CostGuardConfig {
    /** Maximum USD spend per agent session. @default 1.00 */
    maxSessionCostUsd: number;
    /** Maximum USD spend per agent per day. @default 5.00 */
    maxDailyCostUsd: number;
    /** Maximum USD spend per single operation. @default 0.50 */
    maxSingleOperationCostUsd: number;
    /** Callback when a cap is hit. */
    onCapReached?: (agentId: string, capType: CostCapType, currentCost: number, limit: number) => void;
}
export interface CostRecord {
    agentId: string;
    operationId: string;
    costUsd: number;
    timestamp: number;
    metadata?: Record<string, unknown>;
}
export interface CostSnapshot {
    agentId: string;
    sessionCostUsd: number;
    dailyCostUsd: number;
    sessionLimit: number;
    dailyLimit: number;
    isSessionCapReached: boolean;
    isDailyCapReached: boolean;
}
export declare class CostCapExceededError extends Error {
    readonly agentId: string;
    readonly capType: CostCapType;
    readonly currentCost: number;
    readonly limit: number;
    constructor(agentId: string, capType: CostCapType, currentCost: number, limit: number);
}
export declare class CostGuard {
    private agents;
    private config;
    private agentLimits;
    constructor(config?: Partial<CostGuardConfig>);
    canAfford(agentId: string, estimatedCostUsd: number): {
        allowed: boolean;
        reason?: string;
        capType?: CostCapType;
    };
    recordCost(agentId: string, costUsd: number, operationId?: string, metadata?: Record<string, unknown>): CostRecord;
    getSnapshot(agentId: string): CostSnapshot;
    resetSession(agentId: string): void;
    resetDailyAll(): void;
    setAgentLimits(agentId: string, overrides: Partial<Pick<CostGuardConfig, 'maxSessionCostUsd' | 'maxDailyCostUsd'>>): void;
    private getOrCreate;
    private maybeResetDaily;
    private getNextMidnight;
}
//# sourceMappingURL=CostGuard.d.ts.map