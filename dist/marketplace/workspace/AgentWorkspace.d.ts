/**
 * @fileoverview Per-agent workspace directory helpers.
 *
 * Agents that are allowed to perform filesystem operations should do so
 * inside an isolated per-agent workspace directory (a "sandbox folder"),
 * rather than arbitrary locations on the host machine.
 *
 * This module provides small utilities for:
 * - normalizing agent IDs into safe folder names
 * - resolving the base directory for workspaces
 * - resolving the full workspace directory for a given agent
 */
/**
 * Sanitize an arbitrary agent identifier into a safe folder name.
 *
 * - trims whitespace
 * - replaces slashes with '-'
 * - collapses non-alphanumerics to '-'
 * - limits length to 80 chars
 */
export declare function sanitizeAgentWorkspaceId(raw: string): string;
/**
 * Resolve the base directory used for per-agent workspace folders.
 *
 * Override via env vars:
 * - WUNDERLAND_WORKSPACES_DIR (preferred for Wunderland runtimes)
 * - AGENTOS_WORKSPACES_DIR
 * - AGENTOS_AGENT_WORKSPACES_DIR
 */
export declare function resolveAgentWorkspaceBaseDir(): string;
/**
 * Resolve the full workspace directory for an agent.
 */
export declare function resolveAgentWorkspaceDir(agentId: string, baseDir?: string): string;
//# sourceMappingURL=AgentWorkspace.d.ts.map