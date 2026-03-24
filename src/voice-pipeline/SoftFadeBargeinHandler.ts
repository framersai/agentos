/**
 * @module voice-pipeline/SoftFadeBargeinHandler
 *
 * Implements a three-tier soft-fade barge-in policy.
 *
 * Very short speech detections (< `ignoreMs`) are dismissed as noise.
 * Medium-length detections trigger a fade-out pause so the user can speak
 * without an abrupt cut. Long detections (>= `cancelMs`) stop playback
 * outright and inject a conversation marker.
 */

import type { BargeinAction, BargeinContext, IBargeinHandler } from './types.js';

/**
 * Construction options for {@link SoftFadeBargeinHandler}.
 */
export interface SoftFadeBargeinHandlerOptions {
  /**
   * Speech duration threshold in milliseconds below which the barge-in is
   * treated as accidental noise and ignored.
   *
   * @defaultValue 100
   */
  ignoreMs?: number;

  /**
   * Speech duration threshold in milliseconds at or above which the barge-in
   * triggers an immediate cancel rather than a fade-out pause. Must be greater
   * than `ignoreMs` for the fade region to exist.
   *
   * @defaultValue 2000
   */
  cancelMs?: number;

  /**
   * Duration of the TTS fade-out in milliseconds applied when the speech
   * duration falls in the range `[ignoreMs, cancelMs)`.
   *
   * @defaultValue 200
   */
  fadeMs?: number;
}

/**
 * Barge-in handler that applies a three-tier soft-fade strategy.
 *
 * The handler maps the confirmed speech duration to one of three actions:
 *
 * | Speech duration          | Action                                      |
 * |--------------------------|---------------------------------------------|
 * | `< ignoreMs`             | `ignore` — noise, continue TTS uninterrupted |
 * | `>= ignoreMs < cancelMs` | `pause` with `fadeMs` fade-out               |
 * | `>= cancelMs`            | `cancel` with `'[interrupted]'` marker       |
 *
 * @example
 * ```ts
 * const handler = new SoftFadeBargeinHandler({ ignoreMs: 80, cancelMs: 1500, fadeMs: 150 });
 * handler.handleBargein({ speechDurationMs: 500, ... }); // { type: 'pause', fadeMs: 150 }
 * handler.handleBargein({ speechDurationMs: 1600, ... }); // { type: 'cancel', injectMarker: '[interrupted]' }
 * handler.handleBargein({ speechDurationMs: 30, ... });  // { type: 'ignore' }
 * ```
 */
export class SoftFadeBargeinHandler implements IBargeinHandler {
  /**
   * The interruption strategy implemented by this handler.
   * Always `'soft-fade'`.
   */
  readonly mode = 'soft-fade' as const;

  /**
   * Speech duration below which the barge-in is dismissed as noise.
   */
  private readonly ignoreMs: number;

  /**
   * Speech duration at or above which the barge-in escalates to a full cancel.
   */
  private readonly cancelMs: number;

  /**
   * Duration of the TTS audio fade-out applied during a `'pause'` action.
   */
  private readonly fadeMs: number;

  /**
   * Constructs a new {@link SoftFadeBargeinHandler}.
   *
   * @param options - Optional configuration. Defaults to
   *   `{ ignoreMs: 100, cancelMs: 2000, fadeMs: 200 }`.
   */
  constructor(options: SoftFadeBargeinHandlerOptions = {}) {
    this.ignoreMs = options.ignoreMs ?? 100;
    this.cancelMs = options.cancelMs ?? 2000;
    this.fadeMs = options.fadeMs ?? 200;
  }

  /**
   * Evaluate the barge-in context and return the pipeline action.
   *
   * Decision tree (evaluated in order):
   * 1. `speechDurationMs < ignoreMs` → `{ type: 'ignore' }`
   * 2. `speechDurationMs >= cancelMs` → `{ type: 'cancel', injectMarker: '[interrupted]' }`
   * 3. Otherwise → `{ type: 'pause', fadeMs }`
   *
   * @param context - Snapshot of the barge-in state at the moment of detection.
   * @returns The pipeline action to execute.
   */
  handleBargein(context: BargeinContext): BargeinAction {
    const { speechDurationMs } = context;

    if (speechDurationMs < this.ignoreMs) {
      return { type: 'ignore' };
    }

    if (speechDurationMs >= this.cancelMs) {
      return { type: 'cancel', injectMarker: '[interrupted]' };
    }

    return { type: 'pause', fadeMs: this.fadeMs };
  }
}
