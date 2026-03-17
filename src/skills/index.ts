/**
 * @fileoverview Skills module exports.
 *
 * The canonical skills runtime also exists as the standalone package
 * `@framers/agentos-skills` for consumers who don't want the full
 * AgentOS dependency. This barrel keeps the `@framers/agentos/skills`
 * import path working for backward compatibility.
 *
 * @module @framers/agentos/skills
 */

export * from './types.js';
export * from './SkillLoader.js';
export { SkillRegistry, type SkillRegistryOptions } from './SkillRegistry.js';
export * from './paths.js';
