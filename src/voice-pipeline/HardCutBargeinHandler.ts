/**
 * @module voice-pipeline/HardCutBargeinHandler
 *
 * Implements a hard-cut barge-in policy: when the user speaks over TTS output
 * for at least `minSpeechMs` milliseconds, playback is stopped immediately with
 * no fade-out. Short detections below the threshold are treated as accidental
 * noise and ignored.
 */

import type { BargeinAction, BargeinContext, IBargeinHandler } from './types.js';

/**
 * Construction options for {@link HardCutBargeinHandler}.
 */
export interface HardCutBargeinHandlerOptions {
  /**
   * Minimum confirmed speech duration (in milliseconds) required before a
   * barge-in is treated as intentional. Detections shorter than this value are
   * returned as `{ type: 'ignore' }` to avoid reacting to background noise.
   *
   * @defaultValue 300
   */
  minSpeechMs?: number;
}

/**
 * Barge-in handler that applies a hard-cut strategy.
 *
 * When the user speaks over an active TTS stream, this handler immediately
 * cancels playback if the detected speech exceeds `minSpeechMs`. Below that
 * threshold the interruption is considered noise and playback continues
 * uninterrupted.
 *
 * @example
 * ```ts
 * const handler = new HardCutBargeinHandler({ minSpeechMs: 250 });
 * const action = handler.handleBargein({ speechDurationMs: 400, ... });
 * // action.type === 'cancel'
 * ```
 */
export class HardCutBargeinHandler implements IBargeinHandler {
  /**
   * The interruption strategy implemented by this handler.
   * Always `'hard-cut'`.
   */
  readonly mode = 'hard-cut' as const;

  /**
   * Minimum speech duration in milliseconds before the interruption is
   * considered intentional.
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
   * - If `context.speechDurationMs >= minSpeechMs`, returns
   *   `{ type: 'cancel', injectMarker: '[interrupted]' }` to immediately halt TTS.
   * - Otherwise returns `{ type: 'ignore' }` to continue playback.
   *
   * @param context - Snapshot of the barge-in state at the moment of detection.
   * @returns The pipeline action to execute.
   */
  handleBargein(context: BargeinContext): BargeinAction {
    if (context.speechDurationMs >= this.minSpeechMs) {
      return { type: 'cancel', injectMarker: '[interrupted]' };
    }
    return { type: 'ignore' };
  }
}
