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

import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Sanitize an arbitrary agent identifier into a safe folder name.
 *
 * - trims whitespace
 * - replaces slashes with '-'
 * - collapses non-alphanumerics to '-'
 * - limits length to 80 chars
 */
export function sanitizeAgentWorkspaceId(raw: string): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[\\/]/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return cleaned || 'agent';
}

/**
 * Resolve the base directory used for per-agent workspace folders.
 *
 * Override via env vars:
 * - WUNDERLAND_WORKSPACES_DIR (preferred for Wunderland runtimes)
 * - AGENTOS_WORKSPACES_DIR
 * - AGENTOS_AGENT_WORKSPACES_DIR
 */
export function resolveAgentWorkspaceBaseDir(): string {
  const env =
    process.env['WUNDERLAND_WORKSPACES_DIR'] ||
    process.env['AGENTOS_WORKSPACES_DIR'] ||
    process.env['AGENTOS_AGENT_WORKSPACES_DIR'];

  if (typeof env === 'string' && env.trim()) {
    return path.resolve(env.trim());
  }

  // Default: per-agent folders under a Documents-like directory.
  return path.join(os.homedir(), 'Documents', 'AgentOS', 'agents');
}

/**
 * Resolve the full workspace directory for an agent.
 */
export function resolveAgentWorkspaceDir(agentId: string, baseDir?: string): string {
  const base = typeof baseDir === 'string' && baseDir.trim()
    ? path.resolve(baseDir.trim())
    : resolveAgentWorkspaceBaseDir();
  const safeId = sanitizeAgentWorkspaceId(agentId);
  return path.resolve(base, safeId);
}

