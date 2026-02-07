/**
 * @fileoverview Core types for the AgentOS Voice Call System.
 *
 * Voice calls enable agents to make and receive phone calls via telephony
 * providers (Twilio, Telnyx, Plivo). This module defines the call lifecycle
 * state machine, event types, and configuration.
 *
 * Modeled after OpenClaw's voice-call extension architecture with adaptations
 * for the AgentOS extension pack pattern.
 *
 * @module @framers/agentos/voice/types
 */

// ============================================================================
// Provider Identification
// ============================================================================

/**
 * Supported telephony providers. Extensible via string literal union.
 */
export type VoiceProviderName =
  | 'twilio'
  | 'telnyx'
  | 'plivo'
  | 'mock'
  | (string & {});

// ============================================================================
// Call State Machine
// ============================================================================

/**
 * States a voice call can be in. Transitions follow a monotonic order
 * (initiated → ringing → answered → active → speaking/listening),
 * except `speaking` ↔ `listening` which can cycle during conversation.
 * Terminal states can be reached from any non-terminal state.
 */
export type CallState =
  // Non-terminal (forward-only progression)
  | 'initiated'
  | 'ringing'
  | 'answered'
  | 'active'
  // Conversation cycling (can alternate)
  | 'speaking'
  | 'listening'
  // Terminal states
  | 'completed'
  | 'hangup-user'
  | 'hangup-bot'
  | 'timeout'
  | 'error'
  | 'failed'
  | 'no-answer'
  | 'busy'
  | 'voicemail';

/** Set of terminal call states — once reached, no further transitions. */
export const TERMINAL_CALL_STATES = new Set<CallState>([
  'completed',
  'hangup-user',
  'hangup-bot',
  'timeout',
  'error',
  'failed',
  'no-answer',
  'busy',
  'voicemail',
]);

/** States that can cycle during multi-turn conversations. */
export const CONVERSATION_STATES = new Set<CallState>(['speaking', 'listening']);

/** Non-terminal state order for monotonic transition enforcement. */
export const STATE_ORDER: readonly CallState[] = [
  'initiated',
  'ringing',
  'answered',
  'active',
  'speaking',
  'listening',
];

// ============================================================================
// Call Modes
// ============================================================================

/**
 * How the agent interacts during a call:
 * - `notify`: Speak a message and hang up (one-way TTS).
 * - `conversation`: Full duplex conversation with STT + LLM + TTS loop.
 */
export type CallMode = 'notify' | 'conversation';

/**
 * Call direction.
 */
export type CallDirection = 'outbound' | 'inbound';

/**
 * Inbound call policy — how the agent handles incoming calls.
 * - `disabled`: Reject all inbound calls.
 * - `allowlist`: Only accept from allowed numbers.
 * - `pairing`: Accept and pair with agent owner.
 * - `open`: Accept all inbound calls.
 */
export type InboundPolicy = 'disabled' | 'allowlist' | 'pairing' | 'open';

// ============================================================================
// Transcript
// ============================================================================

/** A single entry in a call transcript. */
export interface TranscriptEntry {
  /** Unix timestamp (ms) when this was recorded. */
  timestamp: number;
  /** Who spoke. */
  speaker: 'bot' | 'user';
  /** The spoken text. */
  text: string;
  /** Whether this is a finalized transcript (vs. partial/streaming). */
  isFinal: boolean;
}

// ============================================================================
// Call Record
// ============================================================================

/** Opaque call identifier. */
export type CallId = string;

/**
 * Full record of a voice call — used for tracking, persistence, and status queries.
 */
export interface CallRecord {
  /** Unique call identifier (UUID). */
  callId: CallId;
  /** Provider-assigned call ID (e.g., Twilio CallSid). */
  providerCallId?: string;
  /** Which provider is handling this call. */
  provider: VoiceProviderName;
  /** Current state in the call lifecycle. */
  state: CallState;
  /** Call direction. */
  direction: CallDirection;
  /** Call interaction mode. */
  mode: CallMode;
  /** E.164 phone number of the caller. */
  fromNumber: string;
  /** E.164 phone number being called. */
  toNumber: string;
  /** Agent seed ID (if bound to a specific agent). */
  seedId?: string;
  /** Conversation transcript. */
  transcript: TranscriptEntry[];
  /** IDs of webhook events already processed (idempotency). */
  processedEventIds: string[];
  /** Stream SID for media streams (Twilio-specific). */
  streamSid?: string;
  /** Unix timestamp (ms) when the call was created. */
  createdAt: number;
  /** Unix timestamp (ms) when the call reached a terminal state. */
  endedAt?: number;
  /** Error message if state is 'error' or 'failed'. */
  errorMessage?: string;
  /** Provider-specific metadata. */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Normalized Events (from providers)
// ============================================================================

/**
 * Normalized webhook event from any telephony provider.
 * Uses a discriminated union on the `kind` field.
 */
export type NormalizedCallEvent =
  | NormalizedCallRinging
  | NormalizedCallAnswered
  | NormalizedCallCompleted
  | NormalizedCallFailed
  | NormalizedCallBusy
  | NormalizedCallNoAnswer
  | NormalizedCallVoicemail
  | NormalizedCallHangupUser
  | NormalizedCallError
  | NormalizedTranscript
  | NormalizedSpeechStart
  | NormalizedMediaStreamConnected;

interface NormalizedEventBase {
  /** Provider-assigned event ID for idempotency. */
  eventId: string;
  /** Provider-assigned call ID. */
  providerCallId: string;
  /** Unix timestamp (ms). */
  timestamp: number;
}

export interface NormalizedCallRinging extends NormalizedEventBase {
  kind: 'call-ringing';
}
export interface NormalizedCallAnswered extends NormalizedEventBase {
  kind: 'call-answered';
}
export interface NormalizedCallCompleted extends NormalizedEventBase {
  kind: 'call-completed';
  duration?: number;
}
export interface NormalizedCallFailed extends NormalizedEventBase {
  kind: 'call-failed';
  reason?: string;
}
export interface NormalizedCallBusy extends NormalizedEventBase {
  kind: 'call-busy';
}
export interface NormalizedCallNoAnswer extends NormalizedEventBase {
  kind: 'call-no-answer';
}
export interface NormalizedCallVoicemail extends NormalizedEventBase {
  kind: 'call-voicemail';
}
export interface NormalizedCallHangupUser extends NormalizedEventBase {
  kind: 'call-hangup-user';
}
export interface NormalizedCallError extends NormalizedEventBase {
  kind: 'call-error';
  error: string;
}
export interface NormalizedTranscript extends NormalizedEventBase {
  kind: 'transcript';
  text: string;
  isFinal: boolean;
}
export interface NormalizedSpeechStart extends NormalizedEventBase {
  kind: 'speech-start';
}
export interface NormalizedMediaStreamConnected extends NormalizedEventBase {
  kind: 'media-stream-connected';
  streamSid: string;
}

// ============================================================================
// Webhook Verification
// ============================================================================

/** Raw webhook context passed to provider verification. */
export interface WebhookContext {
  /** HTTP method (usually POST). */
  method: string;
  /** Full request URL (used for signature verification). */
  url: string;
  /** HTTP headers. */
  headers: Record<string, string | string[] | undefined>;
  /** Raw request body (string or Buffer). */
  body: string | Buffer;
  /** Parsed body (for providers that need form-encoded data). */
  parsedBody?: Record<string, string>;
}

/** Result of webhook signature verification. */
export interface WebhookVerificationResult {
  /** Whether the webhook signature is valid. */
  valid: boolean;
  /** Error message if verification failed. */
  error?: string;
}

/** Result of parsing a provider webhook into normalized events. */
export interface WebhookParseResult {
  /** Normalized events extracted from the webhook. */
  events: NormalizedCallEvent[];
  /** Provider-specific raw data for debugging. */
  rawData?: unknown;
}

// ============================================================================
// TTS Configuration (for telephony audio)
// ============================================================================

/** TTS provider for phone audio. */
export type TelephonyTtsProvider = 'openai' | 'elevenlabs' | (string & {});

/** TTS configuration overrides for voice calls. */
export interface VoiceCallTtsConfig {
  /** TTS provider to use. */
  provider?: TelephonyTtsProvider;
  /** Voice ID / name. */
  voice?: string;
  /** Speed multiplier. */
  speed?: number;
  /** Provider-specific options. */
  options?: Record<string, unknown>;
}

/** STT configuration for voice calls. */
export interface VoiceCallSttConfig {
  /** STT provider (currently only 'openai-realtime' supported). */
  provider?: 'openai-realtime' | 'whisper' | (string & {});
  /** Language hint for STT. */
  language?: string;
  /** Provider-specific options. */
  options?: Record<string, unknown>;
}

// ============================================================================
// Voice Call Configuration
// ============================================================================

/** Provider-specific configuration. */
export interface TwilioProviderConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export interface TelnyxProviderConfig {
  apiKey: string;
  connectionId: string;
  publicKey?: string;
  fromNumber: string;
}

export interface PlivoProviderConfig {
  authId: string;
  authToken: string;
  fromNumber: string;
}

/** Union of all provider configs. */
export type ProviderConfig =
  | { provider: 'twilio'; config: TwilioProviderConfig }
  | { provider: 'telnyx'; config: TelnyxProviderConfig }
  | { provider: 'plivo'; config: PlivoProviderConfig }
  | { provider: 'mock'; config?: Record<string, unknown> };

/** Full voice call system configuration. */
export interface VoiceCallConfig {
  /** Active telephony provider. */
  provider: ProviderConfig;
  /** TTS settings for phone audio. */
  tts?: VoiceCallTtsConfig;
  /** STT settings for phone audio. */
  stt?: VoiceCallSttConfig;
  /** Inbound call policy. */
  inboundPolicy?: InboundPolicy;
  /** Allowlist of E.164 numbers (for 'allowlist' policy). */
  allowedNumbers?: string[];
  /** Default call mode for outbound calls. */
  defaultMode?: CallMode;
  /** Maximum call duration in seconds (default: 300 = 5 min). */
  maxDurationSeconds?: number;
  /** Webhook base URL for receiving provider callbacks. */
  webhookBaseUrl?: string;
  /** Media stream configuration. */
  streaming?: {
    /** Whether to use bidirectional media streams. */
    enabled: boolean;
    /** WebSocket path for media streams (default: /voice/media-stream). */
    wsPath?: string;
  };
}
