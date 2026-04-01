/**
 * @file StuckDetector.ts
 * @description Detects when an agent is making no progress by tracking output hashes
 * and error patterns. If the same output or error repeats N times within a window,
 * the agent is flagged as stuck.
 */
const DEFAULT_CONFIG = {
    repetitionThreshold: 3,
    errorRepetitionThreshold: 3,
    windowMs: 300000,
    maxHistoryPerAgent: 50,
};
/** Fast non-crypto string hash (djb2). */
function fastHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return hash;
}
export class StuckDetector {
    constructor(config) {
        this.outputHistory = new Map();
        this.errorHistory = new Map();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    recordOutput(agentId, output) {
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
            if (oscillation)
                return oscillation;
        }
        return { isStuck: false };
    }
    recordError(agentId, errorMessage) {
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
    clearAgent(agentId) {
        this.outputHistory.delete(agentId);
        this.errorHistory.delete(agentId);
    }
    clearAll() {
        this.outputHistory.clear();
        this.errorHistory.clear();
    }
    getOrCreateHistory(map, agentId) {
        let history = map.get(agentId);
        if (!history) {
            history = [];
            map.set(agentId, history);
        }
        return history;
    }
    appendAndPrune(history, hash) {
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
    countTrailingRepeats(history, hash) {
        let count = 0;
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].hash === hash) {
                count++;
            }
            else {
                break;
            }
        }
        return count;
    }
    detectOscillation(history) {
        const len = history.length;
        if (len < 4)
            return null;
        // Check last 4 entries for A,B,A,B pattern
        const a = history[len - 4].hash;
        const b = history[len - 3].hash;
        if (a !== b &&
            history[len - 2].hash === a &&
            history[len - 1].hash === b) {
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
//# sourceMappingURL=StuckDetector.js.map