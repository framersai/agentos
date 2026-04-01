/**
 * @fileoverview Core types for the AgentOS Voice Call System.
 *
 * Voice calls enable agents to make and receive phone calls via telephony
 * providers (Twilio, Telnyx, Plivo). This module defines the call lifecycle
 * state machine, event types, and configuration.
 *
 * ## Call lifecycle state machine
 *
 * ```
 *                   ┌──────────────────────────────────────────────┐
 *                   │             Terminal states                   │
 *                   │  completed | hangup-user | hangup-bot        │
 *                   │  timeout | error | failed | no-answer        │
 *                   │  busy | voicemail                            │
 *                   └───────────────────────────────────────▲──────┘
 *                                                           │ (from any non-terminal)
 *  initiated ──► ringing ──► answered ──► active ──► speaking ◄──► listening
 *       (monotonic forward-only)                    (can cycle)
 * ```
 *
 * Modeled after OpenClaw's voice-call extension architecture with adaptations
 * for the AgentOS extension pack pattern.
 *
 * @module @framers/agentos/voice/types
 */
/**
 * Set of terminal call states -- once reached, no further transitions are
 * allowed by the {@link CallManager} state machine.
 *
 * Used for guard checks: `if (TERMINAL_CALL_STATES.has(call.state)) return;`
 */
export const TERMINAL_CALL_STATES = new Set([
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
/**
 * States that can cycle during multi-turn conversations.
 *
 * The state machine allows free transitions between these two states so that
 * the agent can alternate between speaking and listening without violating
 * monotonic ordering.
 */
export const CONVERSATION_STATES = new Set(['speaking', 'listening']);
/**
 * Non-terminal state order for monotonic transition enforcement.
 *
 * The {@link CallManager} only allows a forward transition when
 * `STATE_ORDER.indexOf(newState) > STATE_ORDER.indexOf(currentState)`.
 * This prevents impossible regressions like `answered` -> `ringing`.
 */
export const STATE_ORDER = [
    'initiated',
    'ringing',
    'answered',
    'active',
    'speaking',
    'listening',
];
//# sourceMappingURL=types.js.map