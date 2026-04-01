/**
 * @file CostGuard.ts
 * @description In-process spending caps per agent session/day.
 * Complements the backend CostService (which handles billing persistence)
 * by enforcing hard limits that halt execution immediately.
 */
export class CostCapExceededError extends Error {
    constructor(agentId, capType, currentCost, limit) {
        super(`Cost cap '${capType}' exceeded for agent '${agentId}': $${currentCost.toFixed(4)} >= $${limit.toFixed(2)}`);
        this.agentId = agentId;
        this.capType = capType;
        this.currentCost = currentCost;
        this.limit = limit;
        this.name = 'CostCapExceededError';
    }
}
const DEFAULT_CONFIG = {
    maxSessionCostUsd: 1.0,
    maxDailyCostUsd: 5.0,
    maxSingleOperationCostUsd: 0.50,
};
export class CostGuard {
    constructor(config) {
        this.agents = new Map();
        this.agentLimits = new Map();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    canAfford(agentId, estimatedCostUsd) {
        if (estimatedCostUsd > this.config.maxSingleOperationCostUsd) {
            return {
                allowed: false,
                reason: `Single operation cost $${estimatedCostUsd.toFixed(4)} exceeds limit $${this.config.maxSingleOperationCostUsd.toFixed(2)}`,
                capType: 'single_operation',
            };
        }
        const costs = this.getOrCreate(agentId);
        this.maybeResetDaily(costs);
        const limits = this.agentLimits.get(agentId);
        const sessionLimit = limits?.maxSessionCostUsd ?? this.config.maxSessionCostUsd;
        const dailyLimit = limits?.maxDailyCostUsd ?? this.config.maxDailyCostUsd;
        if (costs.sessionCost + estimatedCostUsd > sessionLimit) {
            return {
                allowed: false,
                reason: `Session cost $${(costs.sessionCost + estimatedCostUsd).toFixed(4)} would exceed limit $${sessionLimit.toFixed(2)}`,
                capType: 'session',
            };
        }
        if (costs.dailyCost + estimatedCostUsd > dailyLimit) {
            return {
                allowed: false,
                reason: `Daily cost $${(costs.dailyCost + estimatedCostUsd).toFixed(4)} would exceed limit $${dailyLimit.toFixed(2)}`,
                capType: 'daily',
            };
        }
        return { allowed: true };
    }
    recordCost(agentId, costUsd, operationId, metadata) {
        const costs = this.getOrCreate(agentId);
        this.maybeResetDaily(costs);
        costs.sessionCost += costUsd;
        costs.dailyCost += costUsd;
        const record = {
            agentId,
            operationId: operationId ?? `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            costUsd,
            timestamp: Date.now(),
            metadata,
        };
        costs.records.push(record);
        // Check caps and fire callbacks
        const limits = this.agentLimits.get(agentId);
        const sessionLimit = limits?.maxSessionCostUsd ?? this.config.maxSessionCostUsd;
        const dailyLimit = limits?.maxDailyCostUsd ?? this.config.maxDailyCostUsd;
        if (costs.sessionCost >= sessionLimit) {
            this.config.onCapReached?.(agentId, 'session', costs.sessionCost, sessionLimit);
        }
        if (costs.dailyCost >= dailyLimit) {
            this.config.onCapReached?.(agentId, 'daily', costs.dailyCost, dailyLimit);
        }
        return record;
    }
    getSnapshot(agentId) {
        const costs = this.getOrCreate(agentId);
        this.maybeResetDaily(costs);
        const limits = this.agentLimits.get(agentId);
        const sessionLimit = limits?.maxSessionCostUsd ?? this.config.maxSessionCostUsd;
        const dailyLimit = limits?.maxDailyCostUsd ?? this.config.maxDailyCostUsd;
        return {
            agentId,
            sessionCostUsd: costs.sessionCost,
            dailyCostUsd: costs.dailyCost,
            sessionLimit,
            dailyLimit,
            isSessionCapReached: costs.sessionCost >= sessionLimit,
            isDailyCapReached: costs.dailyCost >= dailyLimit,
        };
    }
    resetSession(agentId) {
        const costs = this.agents.get(agentId);
        if (costs) {
            costs.sessionCost = 0;
            costs.records = [];
        }
    }
    resetDailyAll() {
        for (const costs of this.agents.values()) {
            costs.dailyCost = 0;
            costs.dailyResetAt = this.getNextMidnight();
        }
    }
    setAgentLimits(agentId, overrides) {
        this.agentLimits.set(agentId, overrides);
    }
    getOrCreate(agentId) {
        let costs = this.agents.get(agentId);
        if (!costs) {
            costs = {
                sessionCost: 0,
                dailyCost: 0,
                dailyResetAt: this.getNextMidnight(),
                records: [],
            };
            this.agents.set(agentId, costs);
        }
        return costs;
    }
    maybeResetDaily(costs) {
        if (Date.now() >= costs.dailyResetAt) {
            costs.dailyCost = 0;
            costs.dailyResetAt = this.getNextMidnight();
        }
    }
    getNextMidnight() {
        const now = new Date();
        const midnight = new Date(now);
        midnight.setHours(24, 0, 0, 0);
        return midnight.getTime();
    }
}
//# sourceMappingURL=CostGuard.js.map