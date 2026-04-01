/**
 * @fileoverview Skill Loader for AgentOS
 * @module @framers/agentos/skills/SkillLoader
 *
 * Loads skills from directories by parsing SKILL.md files with YAML frontmatter.
 * Skills are modular capabilities that extend agent functionality.
 */
import type { SkillEntry, SkillMetadata, SkillEligibilityContext, ParsedSkillFrontmatter } from './types.js';
/**
 * Parse YAML frontmatter from SKILL.md content.
 * Supports the standard `---` delimited format.
 */
export declare function parseSkillFrontmatter(content: string): {
    frontmatter: ParsedSkillFrontmatter;
    body: string;
};
/**
 * Extract SkillMetadata from parsed frontmatter.
 */
export declare function extractMetadata(frontmatter: ParsedSkillFrontmatter): SkillMetadata | undefined;
/**
 * Load a single skill from a directory.
 *
 * @param skillDir - Path to skill directory (should contain SKILL.md)
 * @returns SkillEntry or null if invalid
 */
export declare function loadSkillFromDir(skillDir: string): Promise<SkillEntry | null>;
/**
 * Load all skills from a directory.
 *
 * @param dir - Parent directory containing skill subdirectories
 * @returns Array of SkillEntry objects
 */
export declare function loadSkillsFromDir(dir: string): Promise<SkillEntry[]>;
/**
 * Filter skill entries by platform.
 */
export declare function filterByPlatform(entries: SkillEntry[], platform: string): SkillEntry[];
/**
 * Filter skill entries by eligibility context.
 */
export declare function filterByEligibility(entries: SkillEntry[], context: SkillEligibilityContext): SkillEntry[];
/**
 * Check if all binary requirements for a skill are met.
 */
export declare function checkBinaryRequirements(entry: SkillEntry, hasBin: (bin: string) => boolean): {
    met: boolean;
    missing: string[];
};
//# sourceMappingURL=SkillLoader.d.ts.map