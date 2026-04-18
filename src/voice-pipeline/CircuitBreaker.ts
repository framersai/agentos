/**
 * @module voice-pipeline/CircuitBreaker
 *
 * Per-provider state machine: tracks failures within a sliding window, trips
 * when the failure count crosses a threshold, and auto-recovers after a
 * cooldown. Auth failures trip permanently (cooldown = Infinity) because a
 * bad API key won't fix itself without operator intervention.
 */

import type { HealthErrorClass } from './VoicePipelineError.js';

export type BreakerState = 'healthy' | 'tripped';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  windowMs: number;
  cooldownMs: number;
  now?: () => number;
}

export interface StateChangeEvent {
  providerId: string;
  from: BreakerState;
  to: BreakerState;
  reason?: HealthErrorClass | 'recover';
}

interface ProviderRecord {
  failures: number[];
  trippedAt: number | null;
  trippedUntil: number;
  currentState: BreakerState;
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly nowFn: () => number;
  private readonly records = new Map<string, ProviderRecord>();
  private readonly listeners = new Set<(event: StateChangeEvent) => void>();

  constructor(opts: CircuitBreakerOptions) {
    this.failureThreshold = opts.failureThreshold;
    this.windowMs = opts.windowMs;
    this.cooldownMs = opts.cooldownMs;
    this.nowFn = opts.now ?? (() => Date.now());
  }

  state(providerId: string): BreakerState {
    const rec = this.getOrCreate(providerId);
    if (rec.currentState === 'tripped' && this.nowFn() >= rec.trippedUntil) {
      this.transition(providerId, rec, 'healthy', 'recover');
    }
    return rec.currentState;
  }

  isAvailable(providerId: string): boolean {
    return this.state(providerId) === 'healthy';
  }

  recordFailure(providerId: string, reason: HealthErrorClass): void {
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

  recordSuccess(providerId: string): void {
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
  tick(_nowHint?: number): void {
    for (const id of this.records.keys()) {
      void this.state(id);
    }
  }

  onStateChange(fn: (event: StateChangeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private getOrCreate(providerId: string): ProviderRecord {
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

  private transition(
    providerId: string,
    rec: ProviderRecord,
    to: BreakerState,
    reason: StateChangeEvent['reason']
  ): void {
    const from = rec.currentState;
    if (from === to) return;
    rec.currentState = to;
    for (const fn of this.listeners) {
      try {
        fn({ providerId, from, to, reason });
      } catch {
        /* one bad listener must not poison the rest */
      }
    }
  }
}
