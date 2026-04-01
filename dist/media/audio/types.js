/**
 * @file types.ts
 * Core type definitions for the audio generation subsystem.
 *
 * These types are consumed by {@link IAudioGenerator}, {@link FallbackAudioProxy},
 * and concrete provider implementations (Suno, Udio, Stable Audio,
 * ElevenLabs SFX, etc.) to provide a unified audio pipeline across multiple
 * provider backends.
 *
 * Audio generation is split into two sub-modalities:
 *
 * - **Music** — full-length musical compositions from text prompts (Suno, Udio,
 *   Stable Audio).
 * - **SFX** — short sound effects from text descriptions (ElevenLabs, Stable
 *   Audio).
 *
 * Not all providers support both; capability negotiation is handled via
 * {@link IAudioGenerator.supports}.
 */
export {};
//# sourceMappingURL=types.js.map