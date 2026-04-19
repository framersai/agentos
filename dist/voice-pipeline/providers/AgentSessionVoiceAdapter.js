/**
 * @module voice-pipeline/providers/AgentSessionVoiceAdapter
 *
 * Adapts an AgentOS {@link AgentSession} to the {@link IVoicePipelineAgentSession}
 * interface required by {@link VoicePipelineOrchestrator}.
 *
 * The adapter wraps `AgentSession.stream(text)` and yields the resulting
 * `textStream` (an `AsyncIterable<string>` of token deltas) as the return
 * value of `sendText()`.
 *
 * ## Abort Handling
 *
 * The `abort()` method is implemented by setting an internal flag that causes
 * the `sendText()` iterator to stop yielding tokens. Since `StreamTextResult`
 * does not expose a native cancellation mechanism, the underlying provider
 * stream continues but its output is discarded.
 */
/**
 * Wraps an AgentOS `AgentSession` as an `IVoicePipelineAgentSession`.
 *
 * @example
 * ```typescript
 * import { agent } from '@framers/agentos';
 * import { AgentSessionVoiceAdapter } from '../../voice-pipeline/index.js';
 *
 * const a = agent({ model: 'gpt-4o' });
 * const session = a.session('voice-session-1');
 * const voiceAdapter = new AgentSessionVoiceAdapter(session);
 *
 * // Use with VoicePipelineOrchestrator
 * orchestrator.startSession(transport, voiceAdapter, overrides);
 * ```
 */
export class AgentSessionVoiceAdapter {
    constructor(session) {
        this.session = session;
        /** Internal abort flag. Set by `abort()`, checked by the token iterator. */
        this.aborted = false;
    }
    /**
     * Send user text to the agent and yield response tokens as an async iterable.
     *
     * The `metadata` parameter carries voice-specific context (speech duration,
     * endpoint reason, confidence, etc.) that could be injected into the agent's
     * context for more informed responses. Currently the metadata is not forwarded
     * to the agent (the AgentSession API doesn't support metadata injection),
     * but it is available for future enhancement.
     *
     * @param text - Transcribed user speech to send to the agent.
     * @param _metadata - Voice turn metadata (reserved for future use).
     * @returns An async iterable of response token strings.
     */
    async *sendText(text, _metadata) {
        this.aborted = false;
        const result = this.session.stream(text);
        for await (const token of result.textStream) {
            if (this.aborted)
                break;
            yield token;
        }
    }
    /**
     * Abort the current generation.
     * Sets an internal flag causing the active `sendText()` iterator to stop
     * yielding tokens. The underlying LLM stream is not explicitly cancelled
     * but its output is discarded.
     */
    abort() {
        this.aborted = true;
    }
}
//# sourceMappingURL=AgentSessionVoiceAdapter.js.map