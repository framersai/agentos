/**
 * @fileoverview Mock voice call provider for development and testing.
 *
 * Simulates the full call lifecycle (initiated -> ringing -> answered -> active -> completed)
 * using in-memory state and setTimeout-driven state progression. No external dependencies.
 *
 * @module @framers/agentos/voice/providers/mock
 */
import type { IVoiceCallProvider, InitiateCallInput, InitiateCallResult, HangupCallInput, PlayTtsInput } from '../IVoiceCallProvider.js';
import type { VoiceCallConfig, NormalizedCallEvent, WebhookContext, WebhookVerificationResult, WebhookParseResult } from '../types.js';
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
export declare class MockVoiceProvider implements IVoiceCallProvider {
    readonly name: "mock";
    private calls;
    private eventHandler?;
    /**
     * Initialize the mock provider. No-op since there is no external service.
     */
    initialize(_config: VoiceCallConfig): Promise<void>;
    /**
     * Shut down the mock provider -- clears all in-flight calls and timers.
     */
    shutdown(): Promise<void>;
    /**
     * Register an event handler. The CallManager calls this to receive
     * normalized events from the provider.
     */
    onEvent(handler: (event: NormalizedCallEvent) => void): void;
    /**
     * Verify a webhook request. Always returns valid for mock provider.
     */
    verifyWebhook(_ctx: WebhookContext): WebhookVerificationResult;
    /**
     * Parse a webhook payload. Returns no events since the mock provider
     * does not receive real webhooks.
     */
    parseWebhookEvent(_ctx: WebhookContext): WebhookParseResult;
    /**
     * Initiate a simulated outbound call. The call progresses through
     * ringing -> answered -> active on short timers.
     */
    initiateCall(input: InitiateCallInput): Promise<InitiateCallResult>;
    /**
     * Hang up a simulated call. Emits a call-completed event and removes
     * the call from the in-memory store.
     */
    hangupCall(input: HangupCallInput): Promise<void>;
    /**
     * Simulate TTS playback. Briefly transitions the call to 'speaking' state
     * then back to 'active' after a short delay.
     */
    playTts(input: PlayTtsInput): Promise<void>;
    /**
     * Advance a call to a new state and emit the corresponding normalized event.
     */
    private emitStateEvent;
}
//# sourceMappingURL=mock.d.ts.map