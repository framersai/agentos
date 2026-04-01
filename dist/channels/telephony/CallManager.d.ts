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
import type { IVoiceCallProvider } from './IVoiceCallProvider.js';
import type { CallId, CallMode, CallRecord, NormalizedCallEvent, VoiceCallConfig, VoiceProviderName, WebhookContext } from './types.js';
/** Events emitted by the CallManager. */
export type CallManagerEventType = 'call:initiated' | 'call:ringing' | 'call:answered' | 'call:active' | 'call:speaking' | 'call:listening' | 'call:ended' | 'call:error' | 'call:transcript' | 'call:speech-start' | 'call:dtmf' | 'media:connected';
export interface CallManagerEvent {
    type: CallManagerEventType;
    callId: CallId;
    call: CallRecord;
    data?: unknown;
}
export type CallManagerEventHandler = (event: CallManagerEvent) => void | Promise<void>;
export declare class CallManager {
    private readonly activeCalls;
    private readonly providerCallIdMap;
    private readonly processedEventIds;
    private readonly providers;
    private readonly handlers;
    private readonly config;
    constructor(config: VoiceCallConfig);
    /**
     * Register a telephony provider.
     */
    registerProvider(provider: IVoiceCallProvider): void;
    /**
     * Get a registered provider by name.
     */
    getProvider(name?: VoiceProviderName): IVoiceCallProvider | undefined;
    /**
     * Register a handler for call events.
     * @returns Unsubscribe function.
     */
    on(handler: CallManagerEventHandler): () => void;
    private emit;
    /**
     * Initiate an outbound phone call.
     *
     * Creates a CallRecord in 'initiated' state, delegates to the provider
     * to place the call, and returns the internal call ID.
     */
    initiateCall(params: {
        toNumber: string;
        fromNumber?: string;
        mode?: CallMode;
        message?: string;
        seedId?: string;
        providerName?: VoiceProviderName;
    }): Promise<CallRecord>;
    /**
     * Hang up a call. Transitions to 'hangup-bot' terminal state.
     */
    hangupCall(callId: CallId): Promise<void>;
    /**
     * Add a bot speech entry to the transcript and transition to speaking.
     */
    speakText(callId: CallId, text: string): void;
    /**
     * Process an incoming webhook from a telephony provider.
     *
     * Verifies the signature, parses events, and applies state transitions.
     * Idempotent — duplicate event IDs are silently skipped.
     */
    processWebhook(providerName: VoiceProviderName, ctx: WebhookContext): void;
    /**
     * Process a single normalized call event.
     */
    processNormalizedEvent(event: NormalizedCallEvent): void;
    /** Get a call by internal ID. */
    getCall(callId: CallId): CallRecord | undefined;
    /** Find a call by provider-assigned call ID. */
    findCallByProviderCallId(providerCallId: string): CallRecord | undefined;
    /** Get all active (non-terminal) calls. */
    getActiveCalls(): CallRecord[];
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
    }): CallRecord | null;
    /**
     * Transition call state with monotonic enforcement.
     *
     * Rules:
     * 1. No-op for same state or already terminal.
     * 2. Terminal states can always be reached from non-terminal.
     * 3. Speaking ↔ Listening can cycle (conversation turns).
     * 4. Otherwise, only forward transitions in STATE_ORDER.
     */
    private transitionState;
    /** Add a transcript entry. */
    private addTranscriptEntry;
    /** Move a call from active tracking after terminal state. */
    private finalizeCall;
    /** Get the default "from" number from config. */
    private getDefaultFromNumber;
    /** Clean up all state (for shutdown). */
    dispose(): void;
}
//# sourceMappingURL=CallManager.d.ts.map