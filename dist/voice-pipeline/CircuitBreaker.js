/**
 * @module voice-pipeline/CircuitBreaker
 *
 * Per-provider state machine: tracks failures within a sliding window, trips
 * when the failure count crosses a threshold, and auto-recovers after a
 * cooldown. Auth failures trip permanently (cooldown = Infinity) because a
 * bad API key won't fix itself without operator intervention.
 */
export class CircuitBreaker {
    constructor(opts) {
        this.records = new Map();
        this.listeners = new Set();
        this.failureThreshold = opts.failureThreshold;
        this.windowMs = opts.windowMs;
        this.cooldownMs = opts.cooldownMs;
        this.nowFn = opts.now ?? (() => Date.now());
    }
    state(providerId) {
        const rec = this.getOrCreate(providerId);
        if (rec.currentState === 'tripped' && this.nowFn() >= rec.trippedUntil) {
            this.transition(providerId, rec, 'healthy', 'recover');
        }
        return rec.currentState;
    }
    isAvailable(providerId) {
        return this.state(providerId) === 'healthy';
    }
    recordFailure(providerId, reason) {
        const rec = this.getOrCreate(providerId);
        const now = this.nowFn();
        // Auth failures are terminal — a bad key won't recover on its own.
        if (reason === 'auth') {
            rec.trippedAt = now;
            rec.trippedUntil = Number.POSITIVE_INFINITY;
            rec.failures = [];
            this.transition(providerId, rec, 'tripped', 'auth');
            return;
        }
        rec.failures.push(now);
        rec.failures = rec.failures.filter((t) => now - t <= this.windowMs);
        if (rec.failures.length >= this.failureThreshold) {
            rec.trippedAt = now;
            rec.trippedUntil = now + this.cooldownMs;
            rec.failures = [];
            this.transition(providerId, rec, 'tripped', reason);
        }
    }
    recordSuccess(providerId) {
        const rec = this.getOrCreate(providerId);
        rec.failures = [];
        if (rec.currentState === 'tripped') {
            rec.trippedAt = null;
            rec.trippedUntil = 0;
            this.transition(providerId, rec, 'healthy', 'recover');
        }
    }
    /** Force a state-transition pass for all tracked providers. Useful when
     *  the caller wants to drive recoveries on a timer. */
    tick(_nowHint) {
        for (const id of this.records.keys()) {
            void this.state(id);
        }
    }
    onStateChange(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    getOrCreate(providerId) {
        let rec = this.records.get(providerId);
        if (!rec) {
            rec = {
                failures: [],
                trippedAt: null,
                trippedUntil: 0,
                currentState: 'healthy',
            };
            this.records.set(providerId, rec);
        }
        return rec;
    }
    transition(providerId, rec, to, reason) {
        const from = rec.currentState;
        if (from === to)
            return;
        rec.currentState = to;
        for (const fn of this.listeners) {
            try {
                fn({ providerId, from, to, reason });
            }
            catch {
                /* one bad listener must not poison the rest */
            }
        }
    }
}
//# sourceMappingURL=CircuitBreaker.js.map