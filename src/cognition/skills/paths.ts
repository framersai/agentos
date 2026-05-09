/**
 * @fileoverview Skills path helpers for AgentOS
 * @module @framers/agentos/skills/paths
 *
 * Provides a canonical resolver for "default" skill directories so runtimes
 * and CLIs don't need to re-implement the same heuristics.
 */

import { existsSync } from 'node:fs';
import * as path from 'node:path';
import os from 'node:os';

export interface ResolveSkillsDirsOptions {
  /** Base directory used to resolve relative --skills-dir entries. Default: process.cwd() */
  cwd?: string;
  /** Comma-separated list of additional skills directories (e.g. CLI flag). */
  skillsDirFlag?: string;
  /** Environment variables to consult. Default: process.env */
  env?: NodeJS.ProcessEnv;

  /** Include `AGENTOS_SKILLS_DIR` if set. Default: true */
  includeAgentosSkillsDir?: boolean;
  /** Include `$CODEX_HOME/skills` if CODEX_HOME is set. Default: true */
  includeCodexHomeSkillsDir?: boolean;
  /** Include `~/.codex/skills`. Default: true */
  includeHomeCodexSkillsDir?: boolean;
  /** Include `<cwd>/skills`. Default: true */
  includeCwdSkillsDir?: boolean;
}

function splitCommaList(raw: string): string[] {
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

function uniqExistingDirs(dirs: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const dir of dirs) {
    const key = path.resolve(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!existsSync(key)) continue;
    result.push(key);
  }

  return result;
}

/**
 * Resolve the "default" skills directories to scan for `SKILL.md` folders.
 *
 * Order is high → low precedence for first-registered wins systems:
 * - CLI flag dirs
 * - AGENTOS_SKILLS_DIR
 * - CODEX_HOME/skills
 * - ~/.codex/skills
 * - <cwd>/skills
 */
export function resolveDefaultSkillsDirs(options?: ResolveSkillsDirsOptions): string[] {
  const env = options?.env ?? process.env;
  const cwd = path.resolve(options?.cwd ?? process.cwd());

  const dirs: string[] = [];

  const skillsDirFlag = typeof options?.skillsDirFlag === 'string' ? options.skillsDirFlag.trim() : '';
  if (skillsDirFlag) {
    for (const part of splitCommaList(skillsDirFlag)) {
      dirs.push(path.resolve(cwd, part));
    }
  }

  if (options?.includeAgentosSkillsDir !== false) {
    const agentosDir = typeof env['AGENTOS_SKILLS_DIR'] === 'string' ? env['AGENTOS_SKILLS_DIR'].trim() : '';
    if (agentosDir) {
      dirs.push(path.resolve(cwd, agentosDir));
    }
  }

  if (options?.includeCodexHomeSkillsDir !== false) {
    const codexHome = typeof env['CODEX_HOME'] === 'string' ? env['CODEX_HOME'].trim() : '';
    if (codexHome) {
      dirs.push(path.join(codexHome, 'skills'));
    }
  }

  if (options?.includeHomeCodexSkillsDir !== false) {
    dirs.push(path.join(os.homedir(), '.codex', 'skills'));
  }

  if (options?.includeCwdSkillsDir !== false) {
    dirs.push(path.join(cwd, 'skills'));
  }

  return uniqExistingDirs(dirs);
}

