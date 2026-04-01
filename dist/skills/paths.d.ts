/**
 * @fileoverview Skills path helpers for AgentOS
 * @module @framers/agentos/skills/paths
 *
 * Provides a canonical resolver for "default" skill directories so runtimes
 * and CLIs don't need to re-implement the same heuristics.
 */
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
export declare function resolveDefaultSkillsDirs(options?: ResolveSkillsDirsOptions): string[];
//# sourceMappingURL=paths.d.ts.map