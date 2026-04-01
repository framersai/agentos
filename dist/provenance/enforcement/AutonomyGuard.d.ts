/**
 * @file AutonomyGuard.ts
 * @description Enforces autonomy rules in sealed mode.
 * Blocks human input/prompting after genesis, logs all human interventions.
 *
 * @module AgentOS/Provenance/Enforcement
 */
import type { AutonomyConfig } from '../types.js';
import type { SignedEventLedger } from '../ledger/SignedEventLedger.js';
export declare class AutonomyGuard {
    private readonly config;
    private readonly ledger;
    private genesisRecorded;
    constructor(config: AutonomyConfig, ledger?: SignedEventLedger | null);
    /**
     * Check if a human action is allowed under the current autonomy config.
     * Throws ProvenanceViolationError if the action is blocked.
     *
     * @param actionType - Type of human action (e.g., 'prompt', 'edit_config', 'add_tool', 'pause', 'stop')
     * @param details - Optional details about the action
     */
    checkHumanAction(actionType: string, details?: Record<string, unknown>): Promise<void>;
    /**
     * Record the genesis event, marking the start of sealed autonomous operation.
     */
    recordGenesis(genesisEventId: string): Promise<void>;
    /**
     * Check if genesis has been recorded.
     */
    isSealed(): boolean;
    /**
     * Check whether a specific action type would be blocked.
     * Returns true if the action is allowed, false if it would be blocked.
     */
    wouldAllow(actionType: string): boolean;
}
//# sourceMappingURL=AutonomyGuard.d.ts.map