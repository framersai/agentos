export type CapabilitySurface = 'agent' | 'generation' | 'runtime';
export type CapabilitySupport = 'enforced' | 'partially_enforced' | 'accepted_but_deferred' | 'runtime_only';
export declare const CAPABILITY_KEYS: readonly ["tools", "memory", "rag", "discovery", "guardrails", "security", "permissions", "hitl", "emergent", "voice", "channels", "output", "provenance", "observability", "controls"];
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];
export declare const BASE_AGENT_CONFIG_CAPABILITY_CONTRACT: {
    readonly tools: {
        readonly agent: "enforced";
        readonly generation: "enforced";
        readonly runtime: "enforced";
    };
    readonly memory: {
        readonly agent: "partially_enforced";
        readonly generation: "runtime_only";
        readonly runtime: "enforced";
    };
    readonly rag: {
        readonly agent: "accepted_but_deferred";
        readonly generation: "runtime_only";
        readonly runtime: "enforced";
    };
    readonly discovery: {
        readonly agent: "accepted_but_deferred";
        readonly generation: "runtime_only";
        readonly runtime: "enforced";
    };
    readonly guardrails: {
        readonly agent: "accepted_but_deferred";
        readonly generation: "partially_enforced";
        readonly runtime: "enforced";
    };
    readonly security: {
        readonly agent: "accepted_but_deferred";
        readonly generation: "runtime_only";
        readonly runtime: "enforced";
    };
    readonly permissions: {
        readonly agent: "accepted_but_deferred";
        readonly generation: "partially_enforced";
        readonly runtime: "enforced";
    };
    readonly hitl: {
        readonly agent: "accepted_but_deferred";
        readonly generation: "runtime_only";
        readonly runtime: "enforced";
    };
    readonly emergent: {
        readonly agent: "accepted_but_deferred";
        readonly generation: "runtime_only";
        readonly runtime: "enforced";
    };
    readonly voice: {
        readonly agent: "accepted_but_deferred";
        readonly generation: "runtime_only";
        readonly runtime: "enforced";
    };
    readonly channels: {
        readonly agent: "accepted_but_deferred";
        readonly generation: "runtime_only";
        readonly runtime: "enforced";
    };
    readonly output: {
        readonly agent: "accepted_but_deferred";
        readonly generation: "runtime_only";
        readonly runtime: "enforced";
    };
    readonly provenance: {
        readonly agent: "accepted_but_deferred";
        readonly generation: "runtime_only";
        readonly runtime: "enforced";
    };
    readonly observability: {
        readonly agent: "partially_enforced";
        readonly generation: "partially_enforced";
        readonly runtime: "enforced";
    };
    readonly controls: {
        readonly agent: "accepted_but_deferred";
        readonly generation: "runtime_only";
        readonly runtime: "enforced";
    };
};
export declare function getCapabilitySupport(surface: CapabilitySurface, key: CapabilityKey): CapabilitySupport;
//# sourceMappingURL=capabilityContract.d.ts.map