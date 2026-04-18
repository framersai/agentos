/**
 * @module voice-pipeline/VoiceMetricsReporter
 *
 * Typed pub/sub bus for voice-pipeline lifecycle events. Chains and
 * circuit breakers emit structured events here; host applications
 * subscribe to forward them to clients (WebSocket frames), metrics
 * systems (Prometheus, Datadog), or logs.
 *
 * Listener errors are swallowed — one bad subscriber must not poison the
 * fan-out path for others.
 */
export class VoiceMetricsReporter {
    constructor() {
        this.listeners = new Set();
    }
    subscribe(fn) {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    }
    emit(event) {
        for (const fn of this.listeners) {
            try {
                fn(event);
            }
            catch {
                /* swallow — one bad listener must not poison the rest */
            }
        }
    }
}
//# sourceMappingURL=VoiceMetricsReporter.js.map