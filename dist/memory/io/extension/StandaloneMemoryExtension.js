/**
 * @fileoverview Extension registration for the standalone SQLite-first
 * `Memory` facade.
 *
 * This exposes the facade through the generic `memory-provider` extension kind
 * so hosts can treat it like any other pluggable memory backend.
 *
 * @module agentos/memory/extension/StandaloneMemoryExtension
 */
import { EXTENSION_KIND_MEMORY_PROVIDER, } from '../../../extensions/types.js';
function isRuntimeMemory(value) {
    return (typeof value === 'object' &&
        value !== null &&
        typeof value.remember === 'function' &&
        typeof value.recall === 'function' &&
        typeof value.forget === 'function' &&
        typeof value.health === 'function');
}
function parseStoreInput(data) {
    if (typeof data === 'string') {
        return { content: data };
    }
    if (typeof data !== 'object' || data === null) {
        throw new Error('Standalone memory store() expects a string or { content, options? }.');
    }
    const parsed = data;
    if (typeof parsed.content !== 'string' || !parsed.content.trim()) {
        throw new Error('Standalone memory store() requires a non-empty content string.');
    }
    return {
        content: parsed.content,
        options: parsed.options,
    };
}
function parseQueryInput(query) {
    if (typeof query === 'string') {
        return { text: query };
    }
    if (typeof query !== 'object' || query === null) {
        throw new Error('Standalone memory query() expects a string or { text|query, options? }.');
    }
    const parsed = query;
    const text = parsed.text ?? parsed.query;
    if (typeof text !== 'string' || !text.trim()) {
        throw new Error('Standalone memory query() requires a non-empty query string.');
    }
    return {
        text,
        options: parsed.options,
    };
}
/**
 * Create a `memory-provider` descriptor for the standalone `Memory` facade.
 */
export function createStandaloneMemoryDescriptor(options) {
    let memory = null;
    const payload = {
        name: 'standalone-memory',
        description: 'SQLite-first standalone memory facade with remember/recall, document ingestion, and self-improving consolidation support.',
        supportedTypes: ['episodic', 'semantic', 'procedural', 'prospective', 'relational'],
        initialize: async (config) => {
            const candidate = config.memory;
            if (!isRuntimeMemory(candidate)) {
                throw new Error('Standalone memory provider requires initialize({ memory }) with remember()/recall()/forget()/health() methods.');
            }
            memory = candidate;
        },
        store: async (_collectionId, data) => {
            if (!memory) {
                throw new Error('Standalone memory provider not initialized.');
            }
            const input = parseStoreInput(data);
            const trace = await memory.remember(input.content, input.options);
            return trace.id;
        },
        query: async (_collectionId, query) => {
            if (!memory) {
                throw new Error('Standalone memory provider not initialized.');
            }
            const input = parseQueryInput(query);
            return (await memory.recall(input.text, input.options));
        },
        delete: async (_collectionId, ids) => {
            if (!memory) {
                throw new Error('Standalone memory provider not initialized.');
            }
            await Promise.all(ids.map((id) => memory.forget(id)));
        },
        getStats: async () => {
            if (!memory) {
                throw new Error('Standalone memory provider not initialized.');
            }
            const health = await memory.health();
            return {
                collections: Object.keys(health.tracesPerScope ?? {}).length,
                documents: health.activeTraces,
                size: health.totalTraces,
            };
        },
        shutdown: async () => {
            if (!memory)
                return;
            if (options?.manageLifecycle) {
                await memory.close?.();
            }
            memory = null;
        },
        ...options?.overrides,
    };
    return {
        id: 'agentos-standalone-memory',
        kind: EXTENSION_KIND_MEMORY_PROVIDER,
        priority: 100,
        enableByDefault: true,
        payload,
        metadata: {
            version: '1.0.0',
            runtime: 'sqlite-first-memory-facade',
        },
    };
}
//# sourceMappingURL=StandaloneMemoryExtension.js.map