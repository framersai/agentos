/**
 * @module voice-pipeline/VoiceInterruptError
 *
 * Typed error thrown when a voice session is interrupted by user barge-in.
 * Used by VoiceNodeExecutor to catch barge-in AbortSignal and return
 * a structured result instead of propagating a generic Error.
 *
 * ## Design rationale
 *
 * Using a typed error subclass (rather than a plain Error with a message string)
 * allows consumers to:
 * 1. Catch specifically via `instanceof VoiceInterruptError`.
 * 2. Access structured fields (`interruptedText`, `userSpeech`,
 *    `playedDurationMs`) without parsing an error message.
 * 3. Distinguish barge-in interruptions from other pipeline errors in
 *    catch blocks and error boundaries.
 *
 * The `name` property is set as a class field (not via the prototype) so that
 * it survives serialisation and can be used for `instanceof`-free checks when
 * errors cross process boundaries (e.g. worker threads, RPC).
 */
/**
 * Structured error representing a user barge-in interruption during TTS playback.
 *
 * Thrown (or returned as a typed sentinel) when the user speaks over the agent.
 * Consumers can inspect `interruptedText`, `userSpeech`, and
 * `playedDurationMs` to decide how to resume or branch the conversation graph.
 *
 * @see {@link IBargeinHandler} which triggers the barge-in decision.
 * @see {@link VoicePipelineOrchestrator} which transitions through INTERRUPTING state.
 *
 * @example Catching a barge-in interruption
 * ```typescript
 * try {
 *   await voiceNode.run(context);
 * } catch (err) {
 *   if (err instanceof VoiceInterruptError) {
 *     console.log(`Agent was saying: "${err.interruptedText}"`);
 *     console.log(`User said: "${err.userSpeech}"`);
 *     console.log(`Played ${err.playedDurationMs}ms before interruption`);
 *     // Resume conversation from the user's barge-in utterance
 *     await handleBargein(err.userSpeech);
 *   } else {
 *     throw err; // Re-throw non-barge-in errors
 *   }
 * }
 * ```
 *
 * @example Checking without instanceof (e.g. cross-process)
 * ```typescript
 * if (error.name === 'VoiceInterruptError') {
 *   // Safe to access barge-in fields
 * }
 * ```
 */
export class VoiceInterruptError extends Error {
    /**
     * Create a new VoiceInterruptError with structured barge-in context.
     *
     * @param context - Barge-in context captured at the moment of interruption.
     * @param context.interruptedText - Full TTS text the agent was speaking.
     * @param context.userSpeech - Transcript of the user's barge-in utterance.
     * @param context.playedDurationMs - Milliseconds of audio already played.
     *
     * @example
     * ```typescript
     * throw new VoiceInterruptError({
     *   interruptedText: 'I was explaining the process of...',
     *   userSpeech: 'Wait, go back to the first step.',
     *   playedDurationMs: 2300,
     * });
     * ```
     */
    constructor(context) {
        super('Voice session interrupted by user');
        /**
         * Discriminant name -- always `'VoiceInterruptError'`.
         *
         * Set as a class field (not via prototype) so it:
         * - Survives JSON serialisation/deserialisation.
         * - Can be used for `instanceof`-free type discrimination.
         * - Overrides the default `Error` name in stack traces.
         */
        this.name = 'VoiceInterruptError';
        this.interruptedText = context.interruptedText;
        this.userSpeech = context.userSpeech;
        this.playedDurationMs = context.playedDurationMs;
    }
}
//# sourceMappingURL=VoiceInterruptError.js.map