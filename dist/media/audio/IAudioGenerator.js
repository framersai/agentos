/**
 * @file IAudioGenerator.ts
 * Provider interface for audio generation (music and sound effects).
 *
 * Follows the same pattern as {@link IVideoGenerator} in the video subsystem:
 * each concrete provider implements this interface, and instances are composed
 * into a {@link FallbackAudioProxy} chain for automatic failover.
 *
 * ## Sub-modality split
 *
 * Audio generation is split into two sub-modalities:
 *
 * - **Music** — full-length compositions ({@link generateMusic}).
 * - **SFX** — short sound effects ({@link generateSFX}).
 *
 * A provider may support one or both. Capability negotiation is done via
 * {@link supports} — the proxy uses this to skip structurally incapable
 * providers rather than counting them as transient failures.
 *
 * @see {@link FallbackAudioProxy} for the failover wrapper.
 * @see {@link IVideoGenerator} for the analogous video interface.
 */
export {};
//# sourceMappingURL=IAudioGenerator.js.map