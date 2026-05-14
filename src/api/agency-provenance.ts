/**
 * @fileoverview Agency-level provenance recorder.
 *
 * Wires an in-memory event trail onto the existing `agency()` event callbacks
 * so {@link AgencyProvenanceConfig} actually does something when `enabled` is
 * `true`. Records agent calls, tool calls, handoffs, emergent forges,
 * guardrail decisions, approval outcomes, and errors. Optional `hashChain`
 * computes a SHA-256 chain so any tampering of the trail in transit is
 * detectable without requiring the full {@link SignedEventLedger} stack
 * (which needs a storage adapter and Ed25519 keypair management).
 *
 * For full cryptographic provenance with signed events, anchor providers, and
 * tombstone enforcement, use `createProvenancePack` at the `AgentOS` runtime
 * layer instead.
 *
 * @module @framers/agentos/api/agency-provenance
 */

import { createHash } from 'node:crypto';
import type {
  AgencyCallbacks,
  AgencyProvenanceConfig,
  AgentStartEvent,
  AgentEndEvent,
  HandoffEvent,
  ToolCallEvent,
  ForgeEvent,
  GuardrailEvent,
  ApprovalDecision,
} from './types.js';

/** A single recorded event in the agency provenance trail. */
export interface AgencyProvenanceEvent {
  /** Monotonic event sequence (0-indexed) within this agency run. */
  sequence: number;
  /** Event kind keyed against the {@link AgencyCallbacks} surface. */
  kind:
    | 'agentStart'
    | 'agentEnd'
    | 'handoff'
    | 'toolCall'
    | 'emergentForge'
    | 'guardrailResult'
    | 'approvalDecided'
    | 'error'
    | 'finalOutput';
  /** Wall-clock timestamp (epoch milliseconds) when the event was recorded. */
  timestamp: number;
  /** Event-specific payload from the underlying callback. */
  payload: Record<string, unknown>;
  /** SHA-256 hex of this event's serialized payload (always set). */
  payloadHash: string;
  /**
   * SHA-256 hex chain link covering `payloadHash` plus the previous event's
   * `chainHash`. Populated only when `hashChain` is enabled in the config.
   */
  chainHash?: string;
}

/** Final aggregated trail returned to the agency caller. */
export interface AgencyProvenanceTrail {
  /** ISO 8601 timestamp when the trail was opened. */
  startedAt: string;
  /** ISO 8601 timestamp when the trail was sealed (final-output recorded). */
  finalizedAt?: string;
  /** Whether the chain field on each event was populated. */
  hashChain: boolean;
  /** Recorded events in original order. */
  events: AgencyProvenanceEvent[];
  /** Convenience: SHA-256 hex of the last event's chainHash (if enabled). */
  tipHash?: string;
}

/** Helper returned by {@link createAgencyProvenanceRecorder}. */
export interface AgencyProvenanceRecorder {
  /**
   * Wrap an existing {@link AgencyCallbacks} bag so each callback also writes
   * to the trail before delegating to the caller's original handler.
   * Returns a new bag — does not mutate the input.
   */
  wrapCallbacks(on?: AgencyCallbacks): AgencyCallbacks;
  /** Append a final-output event sealing the trail. */
  recordFinalOutput(payload: Record<string, unknown>): void;
  /** Snapshot the current trail. Safe to call multiple times. */
  getTrail(): AgencyProvenanceTrail;
}

/**
 * Whether a given event kind should be recorded based on the user-supplied
 * `record` flag map. Missing/undefined map means record everything.
 */
function shouldRecord(
  kind: AgencyProvenanceEvent['kind'],
  record: AgencyProvenanceConfig['record'],
): boolean {
  if (!record) return true;
  // Explicit `false` opts out; anything else (true, undefined) opts in.
  return record[kind] !== false;
}

function hashPayload(payload: Record<string, unknown>): string {
  // Stable JSON serialization for hash-chain stability across recorder calls
  // on the same input. Object key order in serializeStable is deterministic.
  return createHash('sha256').update(serializeStable(payload)).digest('hex');
}

function serializeStable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(serializeStable).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + serializeStable(obj[k])).join(',') +
    '}'
  );
}

function linkChain(previousChainHash: string | undefined, payloadHash: string): string {
  const seed = previousChainHash ?? '';
  return createHash('sha256').update(seed + payloadHash).digest('hex');
}

/**
 * Create a recorder that observes agency callbacks and writes an in-memory
 * provenance trail. The returned trail is what `agency().generate()` exposes
 * as `result.provenanceTrail` when the config has `enabled: true`.
 */
export function createAgencyProvenanceRecorder(
  config: AgencyProvenanceConfig,
): AgencyProvenanceRecorder {
  const events: AgencyProvenanceEvent[] = [];
  const startedAt = new Date().toISOString();
  const hashChain = config.hashChain === true;
  let finalizedAt: string | undefined;
  let lastChainHash: string | undefined;

  const append = (
    kind: AgencyProvenanceEvent['kind'],
    payload: Record<string, unknown>,
  ): void => {
    if (!shouldRecord(kind, config.record)) return;
    const payloadHash = hashPayload(payload);
    const event: AgencyProvenanceEvent = {
      sequence: events.length,
      kind,
      timestamp: Date.now(),
      payload,
      payloadHash,
    };
    if (hashChain) {
      event.chainHash = linkChain(lastChainHash, payloadHash);
      lastChainHash = event.chainHash;
    }
    events.push(event);
  };

  // The callback-wrapping pattern: each wrapped handler captures the trail
  // event then delegates to the user-supplied original (if any). Errors
  // thrown inside user handlers are swallowed elsewhere in the agency
  // dispatcher, so we just wrap defensively here.
  const wrapCallbacks = (on?: AgencyCallbacks): AgencyCallbacks => {
    const original = on ?? {};
    return {
      ...original,
      agentStart: (e: AgentStartEvent) => {
        append('agentStart', e as unknown as Record<string, unknown>);
        original.agentStart?.(e);
      },
      agentEnd: (e: AgentEndEvent) => {
        append('agentEnd', e as unknown as Record<string, unknown>);
        original.agentEnd?.(e);
      },
      handoff: (e: HandoffEvent) => {
        append('handoff', e as unknown as Record<string, unknown>);
        original.handoff?.(e);
      },
      toolCall: (e: ToolCallEvent) => {
        append('toolCall', e as unknown as Record<string, unknown>);
        original.toolCall?.(e);
      },
      emergentForge: (e: ForgeEvent) => {
        append('emergentForge', e as unknown as Record<string, unknown>);
        original.emergentForge?.(e);
      },
      guardrailResult: (e: GuardrailEvent) => {
        append('guardrailResult', e as unknown as Record<string, unknown>);
        original.guardrailResult?.(e);
      },
      approvalDecided: (e: ApprovalDecision) => {
        append('approvalDecided', e as unknown as Record<string, unknown>);
        original.approvalDecided?.(e);
      },
      error: (e: { agent: string; error: Error; timestamp: number }) => {
        append('error', {
          agent: e.agent,
          message: e.error.message,
          stack: e.error.stack,
          timestamp: e.timestamp,
        });
        original.error?.(e);
      },
    };
  };

  const recordFinalOutput = (payload: Record<string, unknown>): void => {
    append('finalOutput', payload);
    finalizedAt = new Date().toISOString();
  };

  const getTrail = (): AgencyProvenanceTrail => ({
    startedAt,
    finalizedAt,
    hashChain,
    events: events.slice(),
    tipHash: hashChain ? lastChainHash : undefined,
  });

  return { wrapCallbacks, recordFinalOutput, getTrail };
}
