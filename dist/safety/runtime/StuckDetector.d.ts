/**
 * @file StuckDetector.ts
 * @description Detects when an agent is making no progress by tracking output hashes
 * and error patterns. If the same output or error repeats N times within a window,
 * the agent is flagged as stuck.
 */
export interface StuckDetectorConfig {
    /** Number of identical outputs before declaring stuck. @default 3 */
    repetitionThreshold: number;
    /** Number of identical errors before declaring stuck. @default 3 */
    errorRepetitionThreshold: number;
    /** Time window in ms for detecting repetition. @default 300000 (5 min) */
    windowMs: number;
    /** Maximum entries to track per agent. @default 50 */
    maxHistoryPerAgent: number;
}
export type StuckReason = 'repeated_output' | 'repeated_error' | 'oscillating';
export interface StuckDetection {
    isStuck: boolean;
    reason?: StuckReason;
    details?: string;
    repetitionCount?: number;
}
export declare class StuckDetector {
    private outputHistory;
    private errorHistory;
    private config;
    constructor(config?: Partial<StuckDetectorConfig>);
    recordOutput(agentId: string, output: string): StuckDetection;
    recordError(agentId: string, errorMessage: string): StuckDetection;
    clearAgent(agentId: string): void;
    clearAll(): void;
    private getOrCreateHistory;
    private appendAndPrune;
    private countTrailingRepeats;
    private detectOscillation;
}
//# sourceMappingURL=StuckDetector.d.ts.map