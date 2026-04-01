/**
 * @fileoverview Skill exporter for emergent tools.
 * @module @framers/agentos/emergent/SkillExporter
 *
 * Converts runtime-forged {@link EmergentTool} instances into the standard
 * SKILL.md + CAPABILITY.yaml format consumed by the agentos-skills-registry
 * and the discovery capability manifest scanner.
 *
 * This enables emergent tools that have proven their worth (agent-tier or
 * shared-tier) to be persisted as first-class skills, discoverable by the
 * capability discovery engine alongside curated human-authored skills.
 *
 * Three export levels:
 * - `exportToolAsSkill()` — pure in-memory string conversion to SKILL.md markdown
 * - `writeSkillFile()` — writes a single SKILL.md to disk
 * - `exportToolAsSkillPack()` — writes both SKILL.md and CAPABILITY.yaml (a full
 *   capability directory ready for scanner pickup)
 */
import type { EmergentTool } from './types.js';
/**
 * Converts an {@link EmergentTool} into a SKILL.md markdown string.
 *
 * The generated SKILL.md follows the standard format used by the curated
 * skills in `packages/agentos-skills/registry/curated/`. It includes
 * YAML frontmatter, a purpose section, usage guidance, a parameter table,
 * and implementation notes.
 *
 * Sandbox tools receive a redaction notice instead of exposed source code —
 * the SKILL.md documents the tool's interface without leaking runtime code.
 *
 * @param tool - The emergent tool to export.
 * @returns Complete SKILL.md content as a string.
 *
 * @example
 * ```ts
 * import { exportToolAsSkill } from '../emergent/SkillExporter';
 *
 * const markdown = exportToolAsSkill(myEmergentTool);
 * console.log(markdown);
 * // ---
 * // name: fetch-data
 * // version: '1.0.0'
 * // ...
 * // ---
 * // # Fetch Data
 * // ...
 * ```
 */
export declare function exportToolAsSkill(tool: EmergentTool): string;
/**
 * Builds a CAPABILITY.yaml content string for an emergent tool.
 *
 * The format matches the schema expected by the capability manifest scanner:
 * ```yaml
 * id: tool:<name>
 * kind: tool
 * name: <name>
 * displayName: <Title Case Name>
 * description: <description>
 * category: emergent
 * tags: [generated, ...]
 * inputSchema: { ... }
 * outputSchema: { ... }
 * skillContent: ./SKILL.md
 * ```
 *
 * @param tool - The emergent tool to export.
 * @returns CAPABILITY.yaml content string.
 */
export declare function buildCapabilityYaml(tool: EmergentTool): string;
/**
 * Writes a SKILL.md file to disk for an emergent tool.
 *
 * Creates the output directory if it does not exist. The file is written to
 * `<outputDir>/<tool.name>/SKILL.md`.
 *
 * @param tool - The emergent tool to export.
 * @param outputDir - Base directory where the skill subdirectory will be created.
 * @returns Absolute path to the written SKILL.md file.
 *
 * @throws {Error} If the filesystem write fails (permissions, disk full, etc.).
 *
 * @example
 * ```ts
 * const skillPath = await writeSkillFile(myTool, '/home/user/.wunderland/capabilities');
 * // => "/home/user/.wunderland/capabilities/my-tool/SKILL.md"
 * ```
 */
export declare function writeSkillFile(tool: EmergentTool, outputDir: string): Promise<string>;
/**
 * Exports an emergent tool as a full skill pack (SKILL.md + CAPABILITY.yaml).
 *
 * Creates a directory named after the tool under `outputDir`, containing both
 * files. This directory structure is compatible with the
 * capability manifest scanner and can be placed in any scan directory
 * (`~/.wunderland/capabilities/`, `./.wunderland/capabilities/`, etc.) for
 * automatic discovery.
 *
 * @param tool - The emergent tool to export.
 * @param outputDir - Base directory where the skill subdirectory will be created.
 * @returns Paths to the written SKILL.md and CAPABILITY.yaml files.
 *
 * @throws {Error} If the filesystem writes fail (permissions, disk full, etc.).
 *
 * @example
 * ```ts
 * const { skillPath, capabilityPath } = await exportToolAsSkillPack(
 *   myTool,
 *   '/home/user/.wunderland/capabilities',
 * );
 * // skillPath     => "/home/user/.wunderland/capabilities/my-tool/SKILL.md"
 * // capabilityPath => "/home/user/.wunderland/capabilities/my-tool/CAPABILITY.yaml"
 * ```
 */
export declare function exportToolAsSkillPack(tool: EmergentTool, outputDir: string): Promise<{
    skillPath: string;
    capabilityPath: string;
}>;
//# sourceMappingURL=SkillExporter.d.ts.map