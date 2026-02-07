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
// INSTALL SPECIFICATIONS
// ============================================================================

/**
 * Supported package manager/installation methods.
 */
export type SkillInstallKind = 'brew' | 'apt' | 'node' | 'go' | 'uv' | 'download';

/**
 * Installation specification for a skill dependency.
 */
export interface SkillInstallSpec {
  /** Unique identifier for this install spec */
  id?: string;

  /** Installation method */
  kind: SkillInstallKind;

  /** Human-readable label */
  label?: string;

  /** Binary names that should exist after install */
  bins?: string[];

  /** Limit to specific OS platforms */
  os?: readonly string[];

  // Brew-specific
  /** Homebrew formula name */
  formula?: string;

  // Apt / Node / uv
  /** Package name (apt package, npm package, uv tool package) */
  package?: string;

  // Go-specific
  /** Go module spec for `go install` (e.g. `golang.org/x/tools/cmd/goimports@latest`) */
  module?: string;

  // Download-specific
  /** Download URL */
  url?: string;

  /** Archive filename for extraction */
  archive?: string;

  /** Whether to extract the archive */
  extract?: boolean;

  /** Number of path components to strip during extraction */
  stripComponents?: number;

  /** Target directory for extracted files */
  targetDir?: string;
}

// ============================================================================
// SKILL METADATA
// ============================================================================

/**
 * Requirements for a skill to be eligible.
 */
export interface SkillRequirements {
  /** All of these binaries must be available */
  bins?: string[];

  /** At least one of these binaries must be available */
  anyBins?: string[];

  /** Required environment variables */
  env?: string[];

  /** Required config paths */
  config?: string[];
}

/**
 * Skill metadata from SKILL.md frontmatter.
 */
export interface SkillMetadata {
  /** Always include this skill regardless of requirements */
  always?: boolean;

  /** Override skill key (default: folder name) */
  skillKey?: string;

  /** Primary environment variable for this skill */
  primaryEnv?: string;

  /** Emoji for display */
  emoji?: string;

  /** Homepage URL */
  homepage?: string;

  /** Limit to specific OS platforms */
  os?: readonly string[];

  /** Requirements for eligibility */
  requires?: SkillRequirements;

  /** Installation specifications */
  install?: SkillInstallSpec[];
}

// ============================================================================
// SKILL INVOCATION
// ============================================================================

/**
 * Policy controlling how a skill can be invoked.
 */
export interface SkillInvocationPolicy {
  /** Whether users can invoke directly via commands */
  userInvocable: boolean;

  /** Whether to disable LLM model invocation */
  disableModelInvocation: boolean;
}

/**
 * Dispatch specification for skill commands.
 */
export interface SkillCommandDispatch {
  /** Dispatch kind (tool invocation) */
  kind: 'tool';

  /** Name of the tool to invoke */
  toolName: string;

  /** How to forward user-provided args */
  argMode?: 'raw';
}

/**
 * Command specification for a skill.
 */
export interface SkillCommandSpec {
  /** Command name (e.g., "/github") */
  name: string;

  /** Parent skill name */
  skillName: string;

  /** Command description */
  description: string;

  /** Optional dispatch behavior */
  dispatch?: SkillCommandDispatch;
}

// ============================================================================
// SKILL ENTRIES & SNAPSHOTS
// ============================================================================

/**
 * Raw skill definition with name and content.
 */
export interface Skill {
  /** Unique skill name (folder name) */
  name: string;

  /** Skill description from frontmatter or first paragraph */
  description: string;

  /** Full SKILL.md content (after frontmatter) */
  content: string;
}

/**
 * Parsed SKILL.md frontmatter.
 */
export type ParsedSkillFrontmatter = Record<string, unknown>;

/**
 * Complete skill entry with all metadata.
 */
export interface SkillEntry {
  /** Core skill data */
  skill: Skill;

  /** Raw frontmatter values */
  frontmatter: ParsedSkillFrontmatter;

  /** Parsed AgentOS/Wunderland/OpenClaw metadata */
  metadata?: SkillMetadata;

  /** Invocation policy */
  invocation?: SkillInvocationPolicy;

  /** Source directory path */
  sourcePath?: string;

  /** Optional source tag indicating where the skill was loaded from (e.g., "bundled", "workspace"). */
  source?: string;
}

/**
 * Context for evaluating skill eligibility.
 */
export interface SkillEligibilityContext {
  /** Current platform(s) */
  platforms: string[];

  /** Check if a binary is available */
  hasBin: (bin: string) => boolean;

  /** Check if any of the binaries are available */
  hasAnyBin: (bins: string[]) => boolean;

  /** Check if an environment variable is set */
  hasEnv?: (envVar: string) => boolean;

  /** Additional note for filtering */
  note?: string;
}

/**
 * Snapshot of skills for agent context.
 */
export interface SkillSnapshot {
  /** Formatted prompt text for LLM */
  prompt: string;

  /** List of included skills with names */
  skills: Array<{ name: string; primaryEnv?: string }>;

  /** Resolved skills */
  resolvedSkills?: Skill[];

  /** Snapshot version */
  version?: number;

  /** Created timestamp */
  createdAt: Date;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configuration for skill loading.
 */
export interface SkillsLoadConfig {
  /** Additional skill directories to scan */
  extraDirs?: string[];

  /** Watch for changes */
  watch?: boolean;

  /** Debounce for watcher (ms) */
  watchDebounceMs?: number;
}

/**
 * Install preferences for skills.
 */
export interface SkillsInstallPreferences {
  /** Prefer Homebrew when available */
  preferBrew: boolean;

  /** Node package manager to use */
  nodeManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
}

/**
 * Per-skill configuration.
 */
export interface SkillConfig {
  /** Whether the skill is enabled */
  enabled?: boolean;

  /** API key for the skill */
  apiKey?: string;

  /** Environment variable overrides */
  env?: Record<string, string>;

  /** Additional configuration */
  config?: Record<string, unknown>;
}

/**
 * Top-level skills configuration.
 */
export interface SkillsConfig {
  /** Allowlist for bundled skills */
  allowBundled?: string[];

  /** Loading configuration */
  load?: SkillsLoadConfig;

  /** Install preferences */
  install?: SkillsInstallPreferences;

  /** Per-skill configurations */
  entries?: Record<string, SkillConfig>;
}

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
