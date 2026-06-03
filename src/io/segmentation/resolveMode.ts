/**
 * @module io/segmentation/resolveMode
 */
import type { SegmentOptions, SegmentationMode } from './types.js';
import { InvalidSegmentationPromptError } from './errors.js';

/**
 * Determine the single active prompt mode from the options.
 *
 * A mode counts as "set" when: `prompt` is a non-empty (trimmed) string,
 * `points` is a non-empty array, `box` is present, or `automatic === true`.
 *
 * @throws {InvalidSegmentationPromptError} when zero or more than one is set.
 */
export function resolveSegmentationMode(opts: SegmentOptions): SegmentationMode {
  const modes: SegmentationMode[] = [];
  if (typeof opts.prompt === 'string' && opts.prompt.trim().length > 0) modes.push('text');
  if (Array.isArray(opts.points) && opts.points.length > 0) modes.push('points');
  if (opts.box) modes.push('box');
  if (opts.automatic === true) modes.push('automatic');

  if (modes.length === 0) {
    throw new InvalidSegmentationPromptError(
      'segment() requires exactly one prompt mode: set one of prompt, points, box, or automatic.',
    );
  }
  if (modes.length > 1) {
    throw new InvalidSegmentationPromptError(
      `segment() accepts exactly one prompt mode, received: ${modes.join(', ')}.`,
    );
  }
  return modes[0];
}
