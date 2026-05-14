#!/usr/bin/env node
// Example: agency() with shared cognitive memory + shared RAG corpus.
//
// Three GMI brains in one agency. The orchestration strategy (sequential
// here) decides the order; the shared state layer means each brain's
// output flows into the next brain's recall + retrieval window without
// an explicit handoff payload.
//
// What this example shows:
//   1. memory: { shared: true } gives every agent in the roster
//      read+write access to the same cognitive memory store
//   2. rag: { ... } points all agents at the same retrieval corpus
//   3. Same .generate() surface as a single agent — drop-in swap
//   4. The companion file examples/single-agent-briefing.mjs runs a
//      single agent() on a comparable task. Diff the two files to see
//      what shared memory + shared RAG add on top of one brain.
//   5. The companion file examples/emergent-hierarchical-spawning.mjs
//      adds runtime synthesis on top: the team can mint a new specialist
//      mid-run when its static roster falls short.
//
// Usage:
//   export OPENAI_API_KEY="sk-..."
//   node examples/agency-shared-memory.mjs

import { agency } from '../dist/index.js';

const provider = process.env.AGENTOS_PROVIDER || 'openai';

async function main() {
  const team = agency({
    provider,
    model: 'gpt-4o',
    strategy: 'sequential',
    memory: { shared: true },
    rag: {
      vectorStore: 'in-memory',
      documents: ['./docs/quic-rfc-9000.md', './docs/tcp-rfc-9293.md'],
      topK: 5,
    },
    agents: {
      researcher: {
        instructions: 'Pull factual claims from the RAG corpus.',
      },
      writer: {
        instructions: "Compose a briefing from the researcher's notes.",
      },
      reviewer: {
        instructions: 'Verify the briefing against the same RAG corpus.',
      },
    },
  });

  const result = await team.generate(
    'Compare QUIC and TCP for low-latency game networking.',
  );

  console.log('\n--- final answer ---\n');
  console.log(result.text);

  console.log('\n--- agent calls (who read which chunks, in what order) ---');
  for (const call of result.agentCalls ?? []) {
    console.log(`  ${call.agent}: ${call.input}`);
  }

  if (result.usage) {
    console.log('\n--- usage ---');
    console.log(JSON.stringify(result.usage, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
