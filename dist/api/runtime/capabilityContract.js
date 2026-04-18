export const CAPABILITY_KEYS = [
    'tools',
    'memory',
    'rag',
    'discovery',
    'guardrails',
    'security',
    'permissions',
    'hitl',
    'emergent',
    'voice',
    'channels',
    'output',
    'provenance',
    'observability',
    'controls',
];
export const BASE_AGENT_CONFIG_CAPABILITY_CONTRACT = {
    tools: { agent: 'enforced', generation: 'enforced', runtime: 'enforced' },
    memory: { agent: 'partially_enforced', generation: 'runtime_only', runtime: 'enforced' },
    rag: { agent: 'accepted_but_deferred', generation: 'runtime_only', runtime: 'enforced' },
    discovery: { agent: 'accepted_but_deferred', generation: 'runtime_only', runtime: 'enforced' },
    guardrails: { agent: 'accepted_but_deferred', generation: 'partially_enforced', runtime: 'enforced' },
    security: { agent: 'accepted_but_deferred', generation: 'runtime_only', runtime: 'enforced' },
    permissions: { agent: 'accepted_but_deferred', generation: 'partially_enforced', runtime: 'enforced' },
    hitl: { agent: 'accepted_but_deferred', generation: 'runtime_only', runtime: 'enforced' },
    emergent: { agent: 'accepted_but_deferred', generation: 'runtime_only', runtime: 'enforced' },
    voice: { agent: 'accepted_but_deferred', generation: 'runtime_only', runtime: 'enforced' },
    channels: { agent: 'accepted_but_deferred', generation: 'runtime_only', runtime: 'enforced' },
    output: { agent: 'accepted_but_deferred', generation: 'runtime_only', runtime: 'enforced' },
    provenance: { agent: 'accepted_but_deferred', generation: 'runtime_only', runtime: 'enforced' },
    observability: { agent: 'partially_enforced', generation: 'partially_enforced', runtime: 'enforced' },
    controls: { agent: 'accepted_but_deferred', generation: 'runtime_only', runtime: 'enforced' },
};
export function getCapabilitySupport(surface, key) {
    return BASE_AGENT_CONFIG_CAPABILITY_CONTRACT[key][surface];
}
//# sourceMappingURL=capabilityContract.js.map