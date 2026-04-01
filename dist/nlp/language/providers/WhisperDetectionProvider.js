export class WhisperDetectionProvider {
    constructor(id, params) {
        this.id = id;
        this.params = params;
        this.isInitialized = false;
    }
    async initialize() { this.isInitialized = true; }
    async detect(_text) {
        // This stub simply returns empty; real implementation would call Whisper transcribe with language auto-detect on audio.
        // For textual fallback, we could incorporate a heuristic.
        return [];
    }
    shutdown() { return Promise.resolve(); }
}
//# sourceMappingURL=WhisperDetectionProvider.js.map