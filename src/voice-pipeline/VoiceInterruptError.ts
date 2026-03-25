/**
 * @module voice-pipeline/VoiceInterruptError
 *
 * Typed error thrown when a voice session is interrupted by user barge-in.
 * Used by VoiceNodeExecutor to catch barge-in AbortSignal and return
 * a structured result instead of propagating the error.
 */

/**
 * Structured error representing a user barge-in interruption during TTS playback.
 *
 * Thrown (or returned as a typed sentinel) when the user speaks over the agent.
 * Consumers can inspect `interruptedText`, `userSpeech`, and `playedDurationMs`
 * to decide how to resume or branch the conversation graph.
 *
 * @example
 * ```typescript
 * try {
 *   await voiceNode.run(context);
 * } catch (err) {
 *   if (err instanceof VoiceInterruptError) {
 *     console.log(`Interrupted after ${err.playedDurationMs}ms`);
 *     await handleBargein(err.userSpeech);
 *   }
 * }
 * ```
 */
export class VoiceInterruptError extends Error {
  /** Discriminant name — always `'VoiceInterruptError'` for `instanceof`-free checks. */
  readonly name = 'VoiceInterruptError';

  /** The text the agent was speaking when interrupted. */
  readonly interruptedText: string;

  /** What the user said that caused the interruption. */
  readonly userSpeech: string;

  /**
   * How much of the agent's response was already played (ms).
   * Derived from the cumulative `durationMs` of `EncodedAudioChunk`s sent
   * to the transport before the barge-in was detected.
   */
  readonly playedDurationMs: number;

  /**
   * @param context - Barge-in context captured at the moment of interruption.
   * @param context.interruptedText - Full TTS text the agent was speaking.
   * @param context.userSpeech - Transcript of the user's barge-in utterance.
   * @param context.playedDurationMs - Milliseconds of audio already played.
   */
  constructor(context: {
    interruptedText: string;
    userSpeech: string;
    playedDurationMs: number;
  }) {
    super('Voice session interrupted by user');
    this.interruptedText = context.interruptedText;
    this.userSpeech = context.userSpeech;
    this.playedDurationMs = context.playedDurationMs;
  }
}
