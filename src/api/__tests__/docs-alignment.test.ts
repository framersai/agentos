import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function read(relativeToThisFile: string): string {
  return readFileSync(new URL(relativeToThisFile, import.meta.url), 'utf8');
}

describe('AgentOS docs alignment', () => {
  it('keeps the package README aligned with the high-level API surface', () => {
    const readme = read('../../../README.md');
    expect(readme).toContain('generateImage');
    expect(readme).toContain('providerOptions');
    expect(readme).toContain('Built-in image providers');
    expect(readme).toContain('examples/high-level-api.mjs');
  });

  it('keeps the high-level API guide aligned with provider-agnostic image generation', () => {
    const guide = read('../../../docs/HIGH_LEVEL_API.md');
    expect(guide).toContain('registerImageProviderFactory');
    expect(guide).toContain('openrouter');
    expect(guide).toContain('replicate');
    expect(guide).toContain('Do not force libraries like Wunderland to adopt `agent()`');
  });

  it('keeps the runnable example and docs homepage aligned with the streamlined APIs', () => {
    const example = read('../../../examples/high-level-api.mjs');
    const docsIndex = read('../../../../../apps/agentos-live-docs/docs/index.md');
    const homepage = read('../../../../../apps/agentos-live-docs/src/pages/index.tsx');

    expect(example).toContain('generateImage');
    expect(docsIndex).toContain('High-Level API');
    expect(homepage).toContain('High-Level API');
    expect(homepage).toContain('/getting-started/high-level-api');
  });

  it('surfaces the unified orchestration guides in the package docs and live docs indexes', () => {
    const packageDocsIndex = read('../../../docs/README.md');
    const liveDocsIndex = read('../../../../../apps/agentos-live-docs/docs/index.md');
    const documentationIndex = read('../../../../../apps/agentos-live-docs/docs/getting-started/documentation-index.md');

    expect(packageDocsIndex).toContain('Unified Orchestration Layer');
    expect(packageDocsIndex).toContain('AgentGraph');
    expect(packageDocsIndex).toContain('workflow() DSL');
    expect(packageDocsIndex).toContain('mission() API');
    expect(liveDocsIndex).toContain('/features/unified-orchestration');
    expect(documentationIndex).toContain('Checkpointing');
  });

  it('keeps the skills runtime and skills tool extension distinct in package metadata and docs', () => {
    const runtimePackage = JSON.parse(read('../../../../agentos-skills/package.json'));
    const extensionPackage = JSON.parse(read('../../../../agentos-ext-skills/package.json'));
    const packageSkillsGuide = read('../../../docs/SKILLS.md');
    const liveSkillsOverview = read('../../../../../apps/agentos-live-docs/docs/skills/overview.md');
    const featureGuide = read('../../../../../apps/agentos-live-docs/docs/features/skills.md');

    expect(runtimePackage.name).toBe('@framers/agentos-skills');
    expect(extensionPackage.name).toBe('@framers/agentos-ext-skills');
    expect(packageSkillsGuide).toContain('@framers/agentos-ext-skills');
    expect(liveSkillsOverview).toContain('@framers/agentos-ext-skills');
    expect(featureGuide).toContain('@framers/agentos-ext-skills');
    expect(featureGuide).toContain('@framers/agentos-skills-registry');
  });
});
