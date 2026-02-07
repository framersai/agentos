/**
 * @fileoverview Voice Call Manager — state machine for call lifecycle.
 *
 * Manages active calls, enforces monotonic state transitions, handles
 * webhook event processing, and persists call records. Provider-agnostic:
 * delegates to {@link IVoiceCallProvider} implementations for actual
 * telephony operations.
 *
 * Modeled after OpenClaw's 888-line CallManager with simplifications
 * for the AgentOS extension architecture.
 *
 * @module @framers/agentos/voice/CallManager
 */

import { randomUUID } from 'node:crypto';
import type { IVoiceCallProvider, InitiateCallInput } from './IVoiceCallProvider.js';
import type {
  CallDirection,
  CallId,
  CallMode,
  CallRecord,
  CallState,
  NormalizedCallEvent,
  TranscriptEntry,
  VoiceCallConfig,
  VoiceProviderName,
  WebhookContext,
} from './types.js';
import {
  CONVERSATION_STATES,
  STATE_ORDER,
  TERMINAL_CALL_STATES,
} from './types.js';

// ============================================================================
// Event Emitter Types
// ============================================================================

/** Events emitted by the CallManager. */
export type CallManagerEventType =
  | 'call:initiated'
  | 'call:ringing'
  | 'call:answered'
  | 'call:active'
  | 'call:speaking'
  | 'call:listening'
  | 'call:ended'
  | 'call:error'
  | 'call:transcript'
  | 'call:speech-start'
  | 'media:connected';

export interface CallManagerEvent {
  type: CallManagerEventType;
  callId: CallId;
  call: CallRecord;
  data?: unknown;
}

export type CallManagerEventHandler = (event: CallManagerEvent) => void | Promise<void>;

// ============================================================================
// CallManager
// ============================================================================

export class CallManager {
  private readonly activeCalls = new Map<CallId, CallRecord>();
  private readonly providerCallIdMap = new Map<string, CallId>();
  private readonly processedEventIds = new Set<string>();
  private readonly providers = new Map<VoiceProviderName, IVoiceCallProvider>();
  private readonly handlers: CallManagerEventHandler[] = [];
  private readonly config: VoiceCallConfig;

  constructor(config: VoiceCallConfig) {
    this.config = config;
  }

  // ── Provider Management ──

  /**
   * Register a telephony provider.
   */
  registerProvider(provider: IVoiceCallProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Get a registered provider by name.
   */
  getProvider(name?: VoiceProviderName): IVoiceCallProvider | undefined {
    if (name) return this.providers.get(name);
    return this.providers.get(this.config.provider.provider);
  }

  // ── Event Handlers ──

  /**
   * Register a handler for call events.
   * @returns Unsubscribe function.
   */
  on(handler: CallManagerEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  private emit(event: CallManagerEvent): void {
    for (const handler of this.handlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error('[CallManager] Event handler error:', err);
          });
        }
      } catch (err) {
        console.error('[CallManager] Event handler error:', err);
      }
    }
  }

  // ── Call Initiation ──

  /**
   * Initiate an outbound phone call.
   *
   * Creates a CallRecord in 'initiated' state, delegates to the provider
   * to place the call, and returns the internal call ID.
   */
  async initiateCall(params: {
    toNumber: string;
    fromNumber?: string;
    mode?: CallMode;
    message?: string;
    seedId?: string;
    providerName?: VoiceProviderName;
  }): Promise<CallRecord> {
    const provider = this.getProvider(params.providerName);
    if (!provider) {
      throw new Error(
        `No provider registered for "${params.providerName || this.config.provider.provider}"`,
      );
    }

    const callId = randomUUID();
    const fromNumber = params.fromNumber || this.getDefaultFromNumber();
    const mode = params.mode || this.config.defaultMode || 'conversation';

    const call: CallRecord = {
      callId,
      provider: provider.name,
      state: 'initiated',
      direction: 'outbound',
      mode,
      fromNumber,
      toNumber: params.toNumber,
      seedId: params.seedId,
      transcript: [],
      processedEventIds: [],
      createdAt: Date.now(),
    };

    this.activeCalls.set(callId, call);

    // Build webhook URLs
    const baseUrl = this.config.webhookBaseUrl || 'http://localhost:3000';
    const webhookUrl = `${baseUrl}/voice/webhook/${provider.name}`;
    const statusCallbackUrl = `${baseUrl}/voice/status/${provider.name}`;
    const mediaStreamUrl = this.config.streaming?.enabled
      ? `${baseUrl.replace('http', 'ws')}${this.config.streaming.wsPath || '/voice/media-stream'}`
      : undefined;

    const input: InitiateCallInput = {
      callId,
      fromNumber,
      toNumber: params.toNumber,
      mode,
      message: params.message,
      notifyVoice: this.config.tts?.voice,
      webhookUrl,
      statusCallbackUrl,
      mediaStreamUrl,
      mediaStreamToken: callId, // Use callId as token for validation
    };

    try {
      const result = await provider.initiateCall(input);

      if (!result.success) {
        this.transitionState(call, 'failed');
        call.errorMessage = result.error;
        this.emit({ type: 'call:error', callId, call, data: { error: result.error } });
        return call;
      }

      call.providerCallId = result.providerCallId;
      this.providerCallIdMap.set(result.providerCallId, callId);
      this.emit({ type: 'call:initiated', callId, call });
    } catch (err) {
      this.transitionState(call, 'error');
      call.errorMessage = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'call:error', callId, call, data: { error: call.errorMessage } });
    }

    return call;
  }

  // ── Call Control ──

  /**
   * Hang up a call. Transitions to 'hangup-bot' terminal state.
   */
  async hangupCall(callId: CallId): Promise<void> {
    const call = this.activeCalls.get(callId);
    if (!call) return;
    if (TERMINAL_CALL_STATES.has(call.state)) return;

    const provider = this.getProvider(call.provider);
    if (provider && call.providerCallId) {
      try {
        await provider.hangupCall({ providerCallId: call.providerCallId });
      } catch (err) {
        console.error('[CallManager] Hangup failed:', err);
      }
    }

    this.transitionState(call, 'hangup-bot');
    call.endedAt = Date.now();
    this.finalizeCall(call);
    this.emit({ type: 'call:ended', callId, call });
  }

  /**
   * Add a bot speech entry to the transcript and transition to speaking.
   */
  speakText(callId: CallId, text: string): void {
    const call = this.activeCalls.get(callId);
    if (!call || TERMINAL_CALL_STATES.has(call.state)) return;

    this.addTranscriptEntry(call, 'bot', text);
    this.transitionState(call, 'speaking');
    this.emit({ type: 'call:speaking', callId, call, data: { text } });
  }

  // ── Webhook Processing ──

  /**
   * Process an incoming webhook from a telephony provider.
   *
   * Verifies the signature, parses events, and applies state transitions.
   * Idempotent — duplicate event IDs are silently skipped.
   */
  processWebhook(providerName: VoiceProviderName, ctx: WebhookContext): void {
    const provider = this.providers.get(providerName);
    if (!provider) {
      console.warn(`[CallManager] Unknown provider: ${providerName}`);
      return;
    }

    // Verify webhook signature
    const verification = provider.verifyWebhook(ctx);
    if (!verification.valid) {
      console.warn(`[CallManager] Webhook verification failed: ${verification.error}`);
      return;
    }

    // Parse events
    const { events } = provider.parseWebhookEvent(ctx);

    for (const event of events) {
      this.processNormalizedEvent(event);
    }
  }

  /**
   * Process a single normalized call event.
   */
  processNormalizedEvent(event: NormalizedCallEvent): void {
    // Idempotency check
    if (this.processedEventIds.has(event.eventId)) return;
    this.processedEventIds.add(event.eventId);

    // Look up call by provider call ID
    const call = this.findCallByProviderCallId(event.providerCallId);
    if (!call) {
      // Could be an inbound call — create record if policy allows
      console.warn(
        `[CallManager] Event for unknown call: ${event.providerCallId} (kind: ${event.kind})`,
      );
      return;
    }

    call.processedEventIds.push(event.eventId);

    switch (event.kind) {
      case 'call-ringing':
        this.transitionState(call, 'ringing');
        this.emit({ type: 'call:ringing', callId: call.callId, call });
        break;

      case 'call-answered':
        this.transitionState(call, 'answered');
        this.emit({ type: 'call:answered', callId: call.callId, call });
        // Auto-transition to active then listening for conversation mode
        if (call.mode === 'conversation') {
          this.transitionState(call, 'active');
          this.emit({ type: 'call:active', callId: call.callId, call });
          this.transitionState(call, 'listening');
          this.emit({ type: 'call:listening', callId: call.callId, call });
        }
        break;

      case 'call-completed':
        this.transitionState(call, 'completed');
        call.endedAt = Date.now();
        this.finalizeCall(call);
        this.emit({ type: 'call:ended', callId: call.callId, call });
        break;

      case 'call-failed':
        this.transitionState(call, 'failed');
        call.errorMessage = event.reason;
        call.endedAt = Date.now();
        this.finalizeCall(call);
        this.emit({ type: 'call:error', callId: call.callId, call, data: { error: event.reason } });
        break;

      case 'call-busy':
        this.transitionState(call, 'busy');
        call.endedAt = Date.now();
        this.finalizeCall(call);
        this.emit({ type: 'call:ended', callId: call.callId, call });
        break;

      case 'call-no-answer':
        this.transitionState(call, 'no-answer');
        call.endedAt = Date.now();
        this.finalizeCall(call);
        this.emit({ type: 'call:ended', callId: call.callId, call });
        break;

      case 'call-voicemail':
        this.transitionState(call, 'voicemail');
        call.endedAt = Date.now();
        this.finalizeCall(call);
        this.emit({ type: 'call:ended', callId: call.callId, call });
        break;

      case 'call-hangup-user':
        this.transitionState(call, 'hangup-user');
        call.endedAt = Date.now();
        this.finalizeCall(call);
        this.emit({ type: 'call:ended', callId: call.callId, call });
        break;

      case 'call-error':
        this.transitionState(call, 'error');
        call.errorMessage = event.error;
        call.endedAt = Date.now();
        this.finalizeCall(call);
        this.emit({ type: 'call:error', callId: call.callId, call, data: { error: event.error } });
        break;

      case 'transcript':
        if (event.isFinal) {
          this.addTranscriptEntry(call, 'user', event.text);
          this.transitionState(call, 'listening');
        }
        this.emit({
          type: 'call:transcript',
          callId: call.callId,
          call,
          data: { text: event.text, isFinal: event.isFinal },
        });
        break;

      case 'speech-start':
        this.emit({ type: 'call:speech-start', callId: call.callId, call });
        break;

      case 'media-stream-connected':
        call.streamSid = event.streamSid;
        this.emit({
          type: 'media:connected',
          callId: call.callId,
          call,
          data: { streamSid: event.streamSid },
        });
        break;
    }
  }

  // ── Query ──

  /** Get a call by internal ID. */
  getCall(callId: CallId): CallRecord | undefined {
    return this.activeCalls.get(callId);
  }

  /** Find a call by provider-assigned call ID. */
  findCallByProviderCallId(providerCallId: string): CallRecord | undefined {
    const callId = this.providerCallIdMap.get(providerCallId);
    if (callId) return this.activeCalls.get(callId);

    // Fallback linear search for edge cases
    for (const call of this.activeCalls.values()) {
      if (call.providerCallId === providerCallId) return call;
    }
    return undefined;
  }

  /** Get all active (non-terminal) calls. */
  getActiveCalls(): CallRecord[] {
    return Array.from(this.activeCalls.values());
  }

  // ── Inbound Call Handling ──

  /**
   * Handle an inbound call based on the configured policy.
   * Creates a CallRecord if the call is accepted.
   */
  handleInboundCall(params: {
    providerCallId: string;
    provider: VoiceProviderName;
    fromNumber: string;
    toNumber: string;
    seedId?: string;
  }): CallRecord | null {
    const policy = this.config.inboundPolicy || 'disabled';

    if (policy === 'disabled') return null;

    if (policy === 'allowlist') {
      const allowed = this.config.allowedNumbers || [];
      if (!allowed.includes(params.fromNumber)) return null;
    }

    const callId = randomUUID();
    const call: CallRecord = {
      callId,
      providerCallId: params.providerCallId,
      provider: params.provider,
      state: 'ringing',
      direction: 'inbound',
      mode: 'conversation',
      fromNumber: params.fromNumber,
      toNumber: params.toNumber,
      seedId: params.seedId,
      transcript: [],
      processedEventIds: [],
      createdAt: Date.now(),
    };

    this.activeCalls.set(callId, call);
    this.providerCallIdMap.set(params.providerCallId, callId);
    this.emit({ type: 'call:ringing', callId, call });

    return call;
  }

  // ── State Machine ──

  /**
   * Transition call state with monotonic enforcement.
   *
   * Rules:
   * 1. No-op for same state or already terminal.
   * 2. Terminal states can always be reached from non-terminal.
   * 3. Speaking ↔ Listening can cycle (conversation turns).
   * 4. Otherwise, only forward transitions in STATE_ORDER.
   */
  private transitionState(call: CallRecord, newState: CallState): void {
    // No-op for same state or already terminal
    if (call.state === newState || TERMINAL_CALL_STATES.has(call.state)) return;

    // Terminal states can always be reached
    if (TERMINAL_CALL_STATES.has(newState)) {
      call.state = newState;
      return;
    }

    // Allow cycling between speaking and listening
    if (CONVERSATION_STATES.has(call.state) && CONVERSATION_STATES.has(newState)) {
      call.state = newState;
      return;
    }

    // Only allow forward transitions
    const currentIndex = STATE_ORDER.indexOf(call.state);
    const newIndex = STATE_ORDER.indexOf(newState);
    if (newIndex > currentIndex) {
      call.state = newState;
    }
  }

  /** Add a transcript entry. */
  private addTranscriptEntry(call: CallRecord, speaker: 'bot' | 'user', text: string): void {
    call.transcript.push({
      timestamp: Date.now(),
      speaker,
      text,
      isFinal: true,
    });
  }

  /** Move a call from active tracking after terminal state. */
  private finalizeCall(call: CallRecord): void {
    // Keep in activeCalls briefly for status queries, then clean up
    // In production, this would persist to DB and then remove
    if (call.providerCallId) {
      this.providerCallIdMap.delete(call.providerCallId);
    }
    for (const eventId of call.processedEventIds) {
      this.processedEventIds.delete(eventId);
    }
    // Remove from active calls after a brief delay for status queries
    setTimeout(() => {
      this.activeCalls.delete(call.callId);
    }, 30_000);
  }

  /** Get the default "from" number from config. */
  private getDefaultFromNumber(): string {
    const prov = this.config.provider;
    if (prov.provider === 'mock') return '';
    return prov.config.fromNumber || '';
  }

  /** Clean up all state (for shutdown). */
  dispose(): void {
    this.activeCalls.clear();
    this.providerCallIdMap.clear();
    this.processedEventIds.clear();
    this.providers.clear();
    this.handlers.length = 0;
  }
}
