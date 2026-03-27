/**
 * @module core/audio/providers/ElevenLabsSFXProvider
 *
 * Sound effect generation provider for the ElevenLabs Sound Generation API.
 *
 * ElevenLabs offers a dedicated sound effects endpoint that generates
 * short audio clips from text descriptions. This provider is SFX-only;
 * it does not support music generation.
 *
 * ## API flow (synchronous)
 *
 * 1. **Generate** — `POST ${baseURL}/sound-generation` with text prompt,
 *    duration, and prompt influence. Returns audio data directly.
 *
 * ## Authentication
 *
 * Requires an `ELEVENLABS_API_KEY`. Sent as `xi-api-key: ${apiKey}`.
 *
 * @see {@link IAudioGenerator} for the provider interface contract.
 */

import type { IAudioGenerator } from '../IAudioGenerator.js';
import type { MusicGenerateRequest, SFXGenerateRequest, AudioResult } from '../types.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the ElevenLabs SFX generation provider.
 *
 * @example
 * ```typescript
 * const config: ElevenLabsSFXProviderConfig = {
 *   apiKey: process.env.ELEVENLABS_API_KEY!,
 * };
 * ```
 */
export interface ElevenLabsSFXProviderConfig {
  /** ElevenLabs API key. Sent as `xi-api-key: ${apiKey}`. */
  apiKey: string;

  /**
   * Base URL for the ElevenLabs API. Override for testing or proxy setups.
   * @default 'https://api.elevenlabs.io/v1'
   */
  baseURL?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Sound effect generation provider connecting to the ElevenLabs API.
 *
 * Implements a synchronous request pattern: a single POST request returns
 * the generated audio data directly. Only supports SFX generation — music
 * generation is not available through this endpoint.
 *
 * @implements {IAudioGenerator}
 *
 * @example
 * ```typescript
 * const provider = new ElevenLabsSFXProvider();
 * await provider.initialize({ apiKey: process.env.ELEVENLABS_API_KEY! });
 *
 * const result = await provider.generateSFX({
 *   prompt: 'Thunder crack followed by heavy rain',
 *   durationSec: 5,
 * });
 * console.log(result.audio[0].base64);
 * ```
 */
export class ElevenLabsSFXProvider implements IAudioGenerator {
  /** @inheritdoc */
  public readonly providerId = 'elevenlabs-sfx';

  /** @inheritdoc */
  public isInitialized = false;

  /** @inheritdoc */
  public defaultModelId?: string;

  /** Internal resolved configuration. */
  private _config!: Required<Pick<ElevenLabsSFXProviderConfig, 'apiKey' | 'baseURL'>>;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Initialize the provider with API credentials and optional configuration.
   *
   * @param config - Configuration object. Must include `apiKey`.
   * @throws {Error} If `apiKey` is missing or empty.
   */
  async initialize(config: Record<string, unknown>): Promise<void> {
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
    if (!apiKey) {
      throw new Error('ElevenLabs SFX provider requires apiKey (ELEVENLABS_API_KEY).');
    }

    this._config = {
      apiKey,
      baseURL:
        typeof config.baseURL === 'string' && config.baseURL.trim()
          ? config.baseURL.trim()
          : 'https://api.elevenlabs.io/v1',
    };

    this.isInitialized = true;
  }

  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------

  /**
   * Music generation is not supported by the ElevenLabs SFX endpoint.
   *
   * @throws {Error} Always throws — use a music-capable provider instead.
   */
  async generateMusic(_request: MusicGenerateRequest): Promise<AudioResult> {
    throw new Error(
      'ElevenLabs SFX provider does not support music generation. Use a music-capable provider.',
    );
  }

  /**
   * Generate a sound effect from a text prompt using the ElevenLabs API.
   *
   * @param request - SFX generation request with prompt and optional params.
   * @returns The generated audio result envelope.
   *
   * @throws {Error} If the provider is not initialized.
   * @throws {Error} If the API returns an error.
   */
  async generateSFX(request: SFXGenerateRequest): Promise<AudioResult> {
    if (!this.isInitialized) {
      throw new Error('ElevenLabs SFX provider is not initialized. Call initialize() first.');
    }

    const url = `${this._config.baseURL}/sound-generation`;

    const body: Record<string, unknown> = {
      text: request.prompt,
      prompt_influence: 0.3,
    };

    if (request.durationSec !== undefined) body.duration_seconds = request.durationSec;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this._config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs SFX generation failed (${response.status}): ${errorText}`);
    }

    // The API returns raw audio bytes. Convert to base64 for the result envelope.
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return {
      created: Math.floor(Date.now() / 1000),
      modelId: 'elevenlabs-sound-generation',
      providerId: this.providerId,
      audio: [{
        base64,
        mimeType: 'audio/mpeg',
        durationSec: request.durationSec,
        providerMetadata: {},
      }],
      usage: {
        totalAudioClips: 1,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Capability query
  // -------------------------------------------------------------------------

  /**
   * ElevenLabs SFX provider only supports sound effect generation.
   *
   * @param capability - The capability to check.
   * @returns `true` only for `'sfx'`; `false` for `'music'`.
   */
  supports(capability: 'music' | 'sfx'): boolean {
    return capability === 'sfx';
  }

  /**
   * Release any resources held by the provider. No-op for HTTP-only providers.
   */
  async shutdown(): Promise<void> {
    this.isInitialized = false;
  }
}
