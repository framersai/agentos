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

interface HistoryEntry {
  hash: number;
  timestamp: number;
}

const DEFAULT_CONFIG: StuckDetectorConfig = {
  repetitionThreshold: 3,
  errorRepetitionThreshold: 3,
  windowMs: 300_000,
  maxHistoryPerAgent: 50,
};

/** Fast non-crypto string hash (djb2). */
function fastHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

export class StuckDetector {
  private outputHistory: Map<string, HistoryEntry[]> = new Map();
  private errorHistory: Map<string, HistoryEntry[]> = new Map();
  private config: StuckDetectorConfig;

  constructor(config?: Partial<StuckDetectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  recordOutput(agentId: string, output: string): StuckDetection {
    const hash = fastHash(output);
    const history = this.getOrCreateHistory(this.outputHistory, agentId);
    this.appendAndPrune(history, hash);

    // Check for straight repetition
    const repeated = this.countTrailingRepeats(history, hash);
    if (repeated >= this.config.repetitionThreshold) {
      return {
        isStuck: true,
        reason: 'repeated_output',
        details: `Same output repeated ${repeated} times`,
        repetitionCount: repeated,
      };
    }

    // Check for oscillation (A, B, A, B pattern)
    if (history.length >= 4) {
      const oscillation = this.detectOscillation(history);
      if (oscillation) return oscillation;
    }

    return { isStuck: false };
  }

  recordError(agentId: string, errorMessage: string): StuckDetection {
    const hash = fastHash(errorMessage);
    const history = this.getOrCreateHistory(this.errorHistory, agentId);
    this.appendAndPrune(history, hash);

    const repeated = this.countTrailingRepeats(history, hash);
    if (repeated >= this.config.errorRepetitionThreshold) {
      return {
        isStuck: true,
        reason: 'repeated_error',
        details: `Same error repeated ${repeated} times`,
        repetitionCount: repeated,
      };
    }

    return { isStuck: false };
  }

  clearAgent(agentId: string): void {
    this.outputHistory.delete(agentId);
    this.errorHistory.delete(agentId);
  }

  clearAll(): void {
    this.outputHistory.clear();
    this.errorHistory.clear();
  }

  private getOrCreateHistory(map: Map<string, HistoryEntry[]>, agentId: string): HistoryEntry[] {
    let history = map.get(agentId);
    if (!history) {
      history = [];
      map.set(agentId, history);
    }
    return history;
  }

  private appendAndPrune(history: HistoryEntry[], hash: number): void {
    const now = Date.now();
    history.push({ hash, timestamp: now });

    // Remove expired entries
    const cutoff = now - this.config.windowMs;
    while (history.length > 0 && history[0].timestamp < cutoff) {
      history.shift();
    }

    // Cap size
    while (history.length > this.config.maxHistoryPerAgent) {
      history.shift();
    }
  }

  private countTrailingRepeats(history: HistoryEntry[], hash: number): number {
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].hash === hash) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  private detectOscillation(history: HistoryEntry[]): StuckDetection | null {
    const len = history.length;
    if (len < 4) return null;

    // Check last 4 entries for A,B,A,B pattern
    const a = history[len - 4].hash;
    const b = history[len - 3].hash;
    if (
      a !== b &&
      history[len - 2].hash === a &&
      history[len - 1].hash === b
    ) {
      return {
        isStuck: true,
        reason: 'oscillating',
        details: 'Agent is alternating between two outputs (A,B,A,B pattern)',
        repetitionCount: 4,
      };
    }

    return null;
  }
}
