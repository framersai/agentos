import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function read(relativeToThisFile: string): string {
  return readFileSync(new URL(relativeToThisFile, import.meta.url), 'utf8');
}

function exists(relativeToThisFile: string): boolean {
  try {
    return existsSync(fileURLToPath(new URL(relativeToThisFile, import.meta.url)));
  } catch { return false; }
}

/** Skip tests that reference files outside the agentos package (e.g. in CI where submodules aren't checked out). */
const hasLiveDocs = exists('../../../../../apps/agentos-live-docs/docs/index.md');
const hasSkillsPackages = exists('../../../../agentos-skills/package.json');
const itIfLiveDocs = hasLiveDocs ? it : it.skip;
const itIfSkills = hasSkillsPackages ? it : it.skip;

describe('AgentOS docs alignment', () => {
  it('keeps the package README aligned with the high-level API surface', () => {
    const readme = read('../../../../README.md');
    expect(readme).toContain('generateImage');
    expect(readme).toContain('providerOptions');
    expect(readme).toContain('Built-in image providers');
    expect(readme).toContain('examples/high-level-api.mjs');
  });

  it('keeps the high-level API guide aligned with provider-agnostic image generation', () => {
    const guide = read('../../../../docs/getting-started/HIGH_LEVEL_API.md');
    expect(guide).toContain('registerImageProviderFactory');
    expect(guide).toContain('openrouter');
    expect(guide).toContain('replicate');
    expect(guide).toContain('Do not force libraries like Wunderland to adopt `agent()`');
  });

  itIfLiveDocs('keeps the runnable example and docs homepage aligned with the streamlined APIs', () => {
    const example = read('../../../../examples/high-level-api.mjs');
    const docsIndex = read('../../../../../apps/agentos-live-docs/docs/index.md');
    const homepage = read('../../../../../apps/agentos-live-docs/src/pages/index.tsx');

    expect(example).toContain('generateImage');
    expect(docsIndex).toContain('High-Level API');
    expect(homepage).toContain('High-Level API');
    expect(homepage).toContain('/getting-started/high-level-api');
  });

  itIfLiveDocs('surfaces the unified orchestration guides in the package docs and live docs indexes', () => {
    const packageDocsIndex = read('../../../../docs/README.md');
    const liveDocsIndex = read('../../../../../apps/agentos-live-docs/docs/index.md');
    const documentationIndex = read('../../../../../apps/agentos-live-docs/docs/getting-started/documentation-index.md');

    expect(packageDocsIndex).toContain('Unified Orchestration Layer');
    expect(packageDocsIndex).toContain('AgentGraph');
    expect(packageDocsIndex).toContain('workflow() DSL');
    expect(packageDocsIndex).toContain('mission() API');
    expect(liveDocsIndex).toContain('/features/unified-orchestration');
    expect(documentationIndex).toContain('Checkpointing');
  });

  itIfSkills('references the 3-tier skills architecture (engine + content + catalog SDK)', () => {
    const contentPackage = JSON.parse(read('../../../../agentos-skills/package.json'));
    const catalogSdkPackage = JSON.parse(read('../../../../agentos-skills-registry/package.json'));
    const packageSkillsGuide = read('../../../../docs/extensions/SKILLS.md');

    // @framers/agentos-skills is now the CONTENT package (SKILL.md files + registry.json)
    expect(contentPackage.name).toBe('@framers/agentos-skills');
    expect(contentPackage.description).toContain('SKILL.md');

    // @framers/agentos-skills-registry is the CATALOG SDK (query helpers, factories)
    expect(catalogSdkPackage.name).toBe('@framers/agentos-skills-registry');
    expect(catalogSdkPackage.description).toContain('Catalog SDK');

    // The skills guide references all three tiers
    expect(packageSkillsGuide).toContain('@framers/agentos/skills');
    expect(packageSkillsGuide).toContain('@framers/agentos-skills');
    expect(packageSkillsGuide).toContain('@framers/agentos-skills-registry');
  });
});
