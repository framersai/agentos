/**
 * @fileoverview Mock voice call provider for development and testing.
 *
 * Simulates the full call lifecycle (initiated -> ringing -> answered -> active -> completed)
 * using in-memory state and setTimeout-driven state progression. No external dependencies.
 *
 * @module @framers/agentos/voice/providers/mock
 */

import type {
  IVoiceCallProvider,
  InitiateCallInput,
  InitiateCallResult,
  HangupCallInput,
  PlayTtsInput,
} from '../IVoiceCallProvider.js';

import type {
  VoiceCallConfig,
  NormalizedCallEvent,
  WebhookContext,
  WebhookVerificationResult,
  WebhookParseResult,
  CallState,
} from '../types.js';

// ---------------------------------------------------------------------------
// Internal call record
// ---------------------------------------------------------------------------

interface MockCallRecord {
  providerCallId: string;
  callId: string;
  from: string;
  to: string;
  state: CallState;
  timers: ReturnType<typeof setTimeout>[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let callCounter = 0;

function nextCallId(): string {
  return `mock-call-${++callCounter}`;
}

function nextEventId(): string {
  return `mock-evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// MockVoiceProvider
// ---------------------------------------------------------------------------

/**
 * A mock IVoiceCallProvider that simulates call lifecycle in-memory.
 *
 * State progression after initiateCall():
 * - 100ms: ringing
 * - 300ms: answered
 * - 500ms: active (call-completed is NOT auto-emitted; call stays active until hangup)
 *
 * @example
 * ```typescript
 * import { MockVoiceProvider } from './providers/mock.js';
 * import { CallManager } from '../CallManager.js';
 *
 * const provider = new MockVoiceProvider();
 * const manager = new CallManager(provider);
 * ```
 */
export class MockVoiceProvider implements IVoiceCallProvider {
  readonly name = 'mock' as const;

  private calls = new Map<string, MockCallRecord>();
  private eventHandler?: (event: NormalizedCallEvent) => void;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Initialize the mock provider. No-op since there is no external service.
   */
  async initialize(_config: VoiceCallConfig): Promise<void> {
    // Nothing to initialize for the mock provider.
  }

  /**
   * Shut down the mock provider -- clears all in-flight calls and timers.
   */
  async shutdown(): Promise<void> {
    for (const call of this.calls.values()) {
      for (const timer of call.timers) {
        clearTimeout(timer);
      }
    }
    this.calls.clear();
    this.eventHandler = undefined;
  }

  // ── Event subscription ───────────────────────────────────────────────────

  /**
   * Register an event handler. The CallManager calls this to receive
   * normalized events from the provider.
   */
  onEvent(handler: (event: NormalizedCallEvent) => void): void {
    this.eventHandler = handler;
  }

  // ── Webhook ──────────────────────────────────────────────────────────────

  /**
   * Verify a webhook request. Always returns valid for mock provider.
   */
  verifyWebhook(_ctx: WebhookContext): WebhookVerificationResult {
    return { valid: true };
  }

  /**
   * Parse a webhook payload. Returns no events since the mock provider
   * does not receive real webhooks.
   */
  parseWebhookEvent(_ctx: WebhookContext): WebhookParseResult {
    return { events: [] };
  }

  // ── Call Control ─────────────────────────────────────────────────────────

  /**
   * Initiate a simulated outbound call. The call progresses through
   * ringing -> answered -> active on short timers.
   */
  async initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
    const providerCallId = nextCallId();

    const record: MockCallRecord = {
      providerCallId,
      callId: input.callId,
      from: input.fromNumber,
      to: input.toNumber,
      state: 'initiated',
      timers: [],
    };

    this.calls.set(providerCallId, record);

    // Simulate state progression
    record.timers.push(
      setTimeout(() => this.emitStateEvent(providerCallId, 'ringing'), 100),
    );
    record.timers.push(
      setTimeout(() => this.emitStateEvent(providerCallId, 'answered'), 300),
    );
    record.timers.push(
      setTimeout(() => this.emitStateEvent(providerCallId, 'active'), 500),
    );

    return { providerCallId, success: true };
  }

  /**
   * Hang up a simulated call. Emits a call-completed event and removes
   * the call from the in-memory store.
   */
  async hangupCall(input: HangupCallInput): Promise<void> {
    const record = this.calls.get(input.providerCallId);
    if (!record) return;

    // Clear any pending state-progression timers
    for (const timer of record.timers) {
      clearTimeout(timer);
    }
    record.timers = [];

    // Emit hangup and completed events
    record.state = 'hangup-bot';
    this.eventHandler?.({
      eventId: nextEventId(),
      providerCallId: input.providerCallId,
      kind: 'call-completed',
      timestamp: Date.now(),
      duration: Math.floor((Date.now() - 0) / 1000),
    });

    this.calls.delete(input.providerCallId);
  }

  /**
   * Simulate TTS playback. Briefly transitions the call to 'speaking' state
   * then back to 'active' after a short delay.
   */
  async playTts(input: PlayTtsInput): Promise<void> {
    const record = this.calls.get(input.providerCallId);
    if (!record) return;

    // Briefly enter 'speaking' state
    record.state = 'speaking';

    // Return to 'active' after simulated speech duration
    record.timers.push(
      setTimeout(() => this.emitStateEvent(input.providerCallId, 'active'), 200),
    );
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  /**
   * Advance a call to a new state and emit the corresponding normalized event.
   */
  private emitStateEvent(providerCallId: string, newState: CallState): void {
    const record = this.calls.get(providerCallId);
    if (!record) return;

    record.state = newState;

    const base = {
      eventId: nextEventId(),
      providerCallId,
      timestamp: Date.now(),
    };

    switch (newState) {
      case 'ringing':
        this.eventHandler?.({ ...base, kind: 'call-ringing' });
        break;
      case 'answered':
        this.eventHandler?.({ ...base, kind: 'call-answered' });
        break;
      case 'active':
        // 'active' is an internal state; no specific normalized event kind for it.
        // We treat transition to active as call-answered if not already sent.
        break;
      case 'completed':
        this.eventHandler?.({ ...base, kind: 'call-completed' });
        break;
      case 'hangup-user':
        this.eventHandler?.({ ...base, kind: 'call-hangup-user' });
        break;
      case 'hangup-bot':
        this.eventHandler?.({ ...base, kind: 'call-completed' });
        break;
      case 'failed':
        this.eventHandler?.({ ...base, kind: 'call-failed', reason: 'mock failure' });
        break;
      case 'error':
        this.eventHandler?.({ ...base, kind: 'call-error', error: 'mock error' });
        break;
      case 'busy':
        this.eventHandler?.({ ...base, kind: 'call-busy' });
        break;
      case 'no-answer':
        this.eventHandler?.({ ...base, kind: 'call-no-answer' });
        break;
      case 'voicemail':
        this.eventHandler?.({ ...base, kind: 'call-voicemail' });
        break;
      default:
        // speaking / listening / initiated -- internal states with no webhook event
        break;
    }
  }
}
