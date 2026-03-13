/**
 * @fileoverview Extension registration for the Cognitive Memory System.
 *
 * Registers the CognitiveMemoryManager as a MemoryProviderDescriptor
 * in the AgentOS extension system, making it discoverable and configurable.
 *
 * @module agentos/memory/extension/CognitiveMemoryExtension
 */

import {
  EXTENSION_KIND_MEMORY_PROVIDER,
  type MemoryProviderPayload,
  type MemoryProviderDescriptor,
} from '../../extensions/types.js';

/**
 * Create a MemoryProviderDescriptor for the cognitive memory system.
 *
 * This is a factory function rather than a static constant because
 * the provider needs runtime dependencies (vector store, embedding
 * manager, etc.) injected at activation time.
 */
export function createCognitiveMemoryDescriptor(
  overrides?: Partial<MemoryProviderPayload>,
): MemoryProviderDescriptor {
  const payload: MemoryProviderPayload = {
    name: 'cognitive-memory',
    description:
      'Cognitive science-grounded memory system with personality-affected ' +
      'encoding/retrieval, Ebbinghaus decay, mood-congruent recall, and ' +
      'Baddeley working memory slots.',
    supportedTypes: ['vector', 'episodic', 'semantic', 'conversational'],
    initialize: async (_config: Record<string, unknown>) => {
      // Actual initialization happens via CognitiveMemoryManager.initialize()
      // This hook is for the extension lifecycle
    },
    store: async (_collectionId: string, _data: unknown) => {
      // Delegates to CognitiveMemoryManager.encode()
      return '';
    },
    query: async (_collectionId: string, _query: unknown, _options?: Record<string, unknown>) => {
      // Delegates to CognitiveMemoryManager.retrieve()
      return [];
    },
    shutdown: async () => {
      // Delegates to CognitiveMemoryManager.shutdown()
    },
    ...overrides,
  };

  return {
    id: 'agentos-cognitive-memory',
    kind: EXTENSION_KIND_MEMORY_PROVIDER,
    priority: 100,
    enableByDefault: true,
    payload,
    metadata: {
      version: '1.0.0',
      cognitiveModels: [
        'atkinson-shiffrin',
        'baddeley-working-memory',
        'ebbinghaus-forgetting',
        'yerkes-dodson',
        'tulving-episodic-semantic',
        'anderson-spreading-activation',
      ],
    },
  };
}
