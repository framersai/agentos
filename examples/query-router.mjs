#!/usr/bin/env node
// Example: QueryRouter classification, retrieval routing, and fallback metadata
//
// Usage:
//   export OPENAI_API_KEY="sk-..."
//   node examples/query-router.mjs

import { QueryRouter } from '../dist/index.js';

async function main() {
  const router = new QueryRouter({
    knowledgeCorpus: ['./docs', './packages/agentos/docs'],
    availableTools: ['web_search', 'deep_research'],
    onClassification: (result) => {
      console.log(
        `[classification] tier=${result.tier} confidence=${result.confidence.toFixed(2)}`
      );
    },
    onRetrieval: (result) => {
      console.log(
        `[retrieval] chunks=${result.chunks.length} strategy=${result.strategy} durationMs=${result.durationMs}`
      );
    },
  });

  await router.init();
  console.log('\n=== corpus stats ===\n');
  console.log(router.getCorpusStats());

  const result = await router.route(
    'How does AgentOS memory retrieval work, and when does it fall back to keyword search?'
  );

  console.log('\n=== answer ===\n');
  console.log(result.answer);

  console.log('\n=== routing metadata ===\n');
  console.log('classified tier:', result.classification.tier);
  console.log('tiers used:', result.tiersUsed);
  console.log('fallbacks used:', result.fallbacksUsed);

  console.log('\n=== sources ===\n');
  for (const source of result.sources) {
    console.log(`- ${source.title} (${source.uri})`);
  }

  await router.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
