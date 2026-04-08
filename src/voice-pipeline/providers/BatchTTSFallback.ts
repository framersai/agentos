/**
 * @module voice-pipeline/providers/BatchTTSFallback
 *
 * Wraps multiple {@link IBatchTTS} providers in priority order.
 * Tries each in sequence; returns the first successful result.
 * Throws an aggregate error if all providers fail.
 */

import type { IBatchTTS, BatchTTSConfig, BatchTTSResult } from '../types.js';

export class BatchTTSFallback implements IBatchTTS {
  readonly providerId = 'fallback';
  private readonly providers: IBatchTTS[];

  constructor(providers: IBatchTTS[]) {
    this.providers = providers;
  }

  async synthesize(text: string, config?: BatchTTSConfig): Promise<BatchTTSResult> {
    if (this.providers.length === 0) {
      throw new Error('No TTS providers configured');
    }

    const errors: Array<{ provider: string; error: Error }> = [];

    for (const provider of this.providers) {
      try {
        return await provider.synthesize(text, config);
      } catch (err) {
        errors.push({
          provider: provider.providerId,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }

    const summary = errors.map((e) => `${e.provider}: ${e.error.message}`).join('; ');
    throw new Error(`All TTS providers failed: ${summary}`);
  }
}
