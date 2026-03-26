/**
 * @module voice-pipeline/HardCutBargeinHandler
 *
 * Implements a hard-cut barge-in policy: when the user speaks over TTS output
 * for at least `HardCutBargeinHandlerOptions.minSpeechMs` milliseconds,
 * playback is stopped immediately with no fade-out. Short detections below the
 * threshold are treated as accidental noise and ignored.
 *
 * ## Why 300 ms default threshold?
 *
 * The 300 ms threshold was chosen to filter out common non-speech audio events
 * that trigger false barge-in detections:
 *
 * - **Lip smacks**: Typically 50-150 ms of energy.
 * - **Breaths/sighs**: Typically 100-250 ms of energy.
 * - **Coughs/sneezes**: Short burst 100-200 ms, but may exceed threshold.
 * - **Background noise spikes**: Door closing, keyboard typing -- usually < 200 ms.
 *
 * At 300 ms, a detection almost certainly represents intentional speech rather
 * than ambient noise. Lowering to < 200 ms increases false positives significantly
 * in noisy environments. Raising to > 500 ms adds noticeable delay before the
 * agent acknowledges the interruption.
 *
 * ## When to use hard-cut vs soft-fade
 *
 * Use hard-cut when:
 * - The conversation style is fast-paced (e.g. customer support).
 * - Users expect immediate response to interruption.
 * - Audio quality is high (fewer false positives).
 *
 * Use {@link SoftFadeBargeinHandler} when:
 * - The conversation is more measured (e.g. storytelling, education).
 * - Users may accidentally trigger barge-in (noisy environment).
 * - A smoother audio experience is preferred.
 *
 * @see {@link SoftFadeBargeinHandler} for the three-tier soft-fade alternative.
 * @see {@link IBargeinHandler} for the interface contract.
 */

import type { BargeinAction, BargeinContext, IBargeinHandler } from './types.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link HardCutBargeinHandler}.
 *
 * @example
 * ```typescript
 * const handler = new HardCutBargeinHandler({ minSpeechMs: 250 });
 * ```
 */
export interface HardCutBargeinHandlerOptions {
  /**
   * Minimum confirmed speech duration (in milliseconds) required before a
   * barge-in is treated as intentional. Detections shorter than this value are
   * returned as `{ type: 'ignore' }` to avoid reacting to background noise,
   * lip smacks, breaths, or other brief non-speech audio events.
   *
   * @defaultValue 300
   *
   * @see Module-level documentation for rationale behind the 300 ms default.
   */
  minSpeechMs?: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Barge-in handler that applies a hard-cut strategy.
 *
 * When the user speaks over an active TTS stream, this handler immediately
 * cancels playback if the detected speech exceeds `minSpeechMs`. Below
 * that threshold the interruption is considered noise and playback continues
 * uninterrupted.
 *
 * The handler is stateless -- each `handleBargein` call is evaluated
 * independently with no memory of previous barge-in events.
 *
 * @see {@link IBargeinHandler} for the interface contract.
 * @see {@link SoftFadeBargeinHandler} for the three-tier alternative.
 *
 * @example
 * ```typescript
 * const handler = new HardCutBargeinHandler({ minSpeechMs: 250 });
 *
 * // Short noise -> ignored
 * handler.handleBargein({ speechDurationMs: 100, interruptedText: '...', playedDurationMs: 500 });
 * // -> { type: 'ignore' }
 *
 * // Intentional speech -> cancel
 * handler.handleBargein({ speechDurationMs: 400, interruptedText: '...', playedDurationMs: 500 });
 * // -> { type: 'cancel', injectMarker: '[interrupted]' }
 * ```
 */
export class HardCutBargeinHandler implements IBargeinHandler {
  /**
   * The interruption strategy implemented by this handler.
   * Always `'hard-cut'` -- playback is stopped instantly with no fade.
   */
  readonly mode = 'hard-cut' as const;

  /**
   * Minimum speech duration in milliseconds before the interruption is
   * considered intentional. Set once at construction and never changed.
   */
  private readonly minSpeechMs: number;

  /**
   * Constructs a new {@link HardCutBargeinHandler}.
   *
   * @param options - Optional configuration. Defaults to `{ minSpeechMs: 300 }`.
   */
  constructor(options: HardCutBargeinHandlerOptions = {}) {
    this.minSpeechMs = options.minSpeechMs ?? 300;
  }

  /**
   * Evaluate the barge-in context and return the action the pipeline should take.
   *
   * Decision logic (binary threshold):
   * - `speechDurationMs >= minSpeechMs` -> Cancel TTS immediately and inject
   *   an `'[interrupted]'` marker into the conversation context.
   * - `speechDurationMs < minSpeechMs` -> Ignore the detection as noise.
   *
   * @param context - Snapshot of the barge-in state at the moment of detection.
   * @returns The pipeline action to execute. Always synchronous (no Promise).
   */
  handleBargein(context: BargeinContext): BargeinAction {
    if (context.speechDurationMs >= this.minSpeechMs) {
      // Speech duration meets the threshold -> intentional interruption.
      // The '[interrupted]' marker is injected into the conversation history
      // so the agent knows its previous response was cut short and can avoid
      // repeating the interrupted content.
      return { type: 'cancel', injectMarker: '[interrupted]' };
    }

    // Below threshold -> likely noise, lip smack, or breath.
    // Continue TTS playback as if nothing happened.
    return { type: 'ignore' };
  }
}
