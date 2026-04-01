/**
 * @fileoverview Skills Registry Types for AgentOS
 * @module @framers/agentos/skills/types
 *
 * Skills are modular capabilities defined in SKILL.md files with
 * YAML frontmatter specifying metadata, requirements, and install specs.
 *
 * This module is adapted from the Wunderland/OpenClaw skills system.
 */
// ============================================================================
// CONSTANTS
// ============================================================================
/** Maximum length for skill command names */
export const SKILL_COMMAND_MAX_LENGTH = 32;
/** Fallback command name */
export const SKILL_COMMAND_FALLBACK = 'skill';
/** Maximum length for skill command descriptions (Discord limit) */
export const SKILL_COMMAND_DESCRIPTION_MAX_LENGTH = 100;
/** Default snapshot version */
export const DEFAULT_SNAPSHOT_VERSION = 1;
//# sourceMappingURL=types.js.map