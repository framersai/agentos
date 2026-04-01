/**
 * @fileoverview Extension registration for the Cognitive Memory System.
 *
 * Registers the CognitiveMemoryManager as a MemoryProviderDescriptor
 * in the AgentOS extension system, making it discoverable and configurable.
 *
 * @module agentos/memory/extension/CognitiveMemoryExtension
 */
import { type MemoryProviderPayload, type MemoryProviderDescriptor } from '../../../extensions/types.js';
/**
 * Create a MemoryProviderDescriptor for the cognitive memory system.
 *
 * This is a factory function rather than a static constant because
 * the provider needs runtime dependencies (vector store, embedding
 * manager, etc.) injected at activation time.
 */
export declare function createCognitiveMemoryDescriptor(overrides?: Partial<MemoryProviderPayload>): MemoryProviderDescriptor;
//# sourceMappingURL=CognitiveMemoryExtension.d.ts.map