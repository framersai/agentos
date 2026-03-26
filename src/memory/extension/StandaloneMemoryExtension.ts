/**
 * @fileoverview Extension registration for the standalone SQLite-first
 * `Memory` facade.
 *
 * This exposes the facade through the generic `memory-provider` extension kind
 * so hosts can treat it like any other pluggable memory backend.
 *
 * @module agentos/memory/extension/StandaloneMemoryExtension
 */

import {
  EXTENSION_KIND_MEMORY_PROVIDER,
  type MemoryProviderPayload,
  type MemoryProviderDescriptor,
} from '../../extensions/types.js';
import type { Memory } from '../facade/Memory.js';
import type { RecallOptions, RememberOptions } from '../facade/index.js';

type RuntimeStandaloneMemory = Pick<
  Memory,
  'remember' | 'recall' | 'forget' | 'health'
> &
  Partial<Pick<Memory, 'close'>>;

type StandaloneMemoryStoreInput = {
  content: string;
  options?: RememberOptions;
};

type StandaloneMemoryQueryInput = {
  text?: string;
  query?: string;
  options?: RecallOptions;
};

export interface StandaloneMemoryDescriptorOptions {
  /**
   * When true, the descriptor's `shutdown()` will close the configured
   * `Memory` instance.
   * @default false
   */
  manageLifecycle?: boolean;

  /**
   * Optional payload overrides.
   */
  overrides?: Partial<MemoryProviderPayload>;
}

function isRuntimeMemory(value: unknown): value is RuntimeStandaloneMemory {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RuntimeStandaloneMemory).remember === 'function' &&
    typeof (value as RuntimeStandaloneMemory).recall === 'function' &&
    typeof (value as RuntimeStandaloneMemory).forget === 'function' &&
    typeof (value as RuntimeStandaloneMemory).health === 'function'
  );
}

function parseStoreInput(data: unknown): StandaloneMemoryStoreInput {
  if (typeof data === 'string') {
    return { content: data };
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error(
      'Standalone memory store() expects a string or { content, options? }.',
    );
  }

  const parsed = data as Partial<StandaloneMemoryStoreInput>;
  if (typeof parsed.content !== 'string' || !parsed.content.trim()) {
    throw new Error('Standalone memory store() requires a non-empty content string.');
  }

  return {
    content: parsed.content,
    options: parsed.options,
  };
}

function parseQueryInput(query: unknown): { text: string; options?: RecallOptions } {
  if (typeof query === 'string') {
    return { text: query };
  }
  if (typeof query !== 'object' || query === null) {
    throw new Error(
      'Standalone memory query() expects a string or { text|query, options? }.',
    );
  }

  const parsed = query as Partial<StandaloneMemoryQueryInput>;
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
export function createStandaloneMemoryDescriptor(
  options?: StandaloneMemoryDescriptorOptions,
): MemoryProviderDescriptor {
  let memory: RuntimeStandaloneMemory | null = null;

  const payload: MemoryProviderPayload = {
    name: 'standalone-memory',
    description:
      'SQLite-first standalone memory facade with remember/recall, document ingestion, and self-improving consolidation support.',
    supportedTypes: ['episodic', 'semantic', 'procedural', 'prospective'],
    initialize: async (config: Record<string, unknown>) => {
      const candidate = config.memory;
      if (!isRuntimeMemory(candidate)) {
        throw new Error(
          'Standalone memory provider requires initialize({ memory }) with remember()/recall()/forget()/health() methods.',
        );
      }
      memory = candidate;
    },
    store: async (_collectionId: string, data: unknown) => {
      if (!memory) {
        throw new Error('Standalone memory provider not initialized.');
      }
      const input = parseStoreInput(data);
      const trace = await memory.remember(input.content, input.options);
      return trace.id;
    },
    query: async (_collectionId: string, query: unknown) => {
      if (!memory) {
        throw new Error('Standalone memory provider not initialized.');
      }
      const input = parseQueryInput(query);
      return (await memory.recall(input.text, input.options)) as unknown[];
    },
    delete: async (_collectionId: string, ids: string[]) => {
      if (!memory) {
        throw new Error('Standalone memory provider not initialized.');
      }
      await Promise.all(ids.map((id) => memory!.forget(id)));
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
      if (!memory) return;
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
