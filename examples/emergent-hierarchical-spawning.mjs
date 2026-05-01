#!/usr/bin/env node
// Example: agency() with hierarchical strategy + emergent agent spawning
//
// The manager agent gets a `spawn_specialist` tool alongside its
// `delegate_to_<name>` tools. When the goal calls for a capability the
// static roster doesn't cover, the manager calls spawn_specialist with a
// role + instructions, EmergentAgentForge synthesises a config, optionally
// EmergentAgentJudge gates the spec on safety/scope/risk, and the new
// agent joins the live roster (`delegate_to_<role>` becomes available on
// the manager's next turn).
//
// What this example shows:
//   1. Hierarchical strategy with two static agents (researcher, writer)
//   2. emergent.enabled + emergent.judge for spec-level safety review
//   3. Planner config — maxSpecialists cap, requireJustification flag,
//      maxJudgeCalls cost bound, custom judgeModel for cost-conscious deploys
//   4. emergentForge callback for observability
//   5. HITL approval gate (beforeEmergent) for high-stakes deployments
//
// Usage:
//   export OPENAI_API_KEY="sk-..."
//   node examples/emergent-hierarchical-spawning.mjs

import { agency } from '../dist/index.js';

const provider = process.env.AGENTOS_PROVIDER || 'openai';

async function main() {
  const research = agency({
    provider,
    model: 'gpt-4o',
    instructions:
      'Coordinate the team to produce a thorough research report. Delegate ' +
      'subtasks to the researcher and writer. If you need a capability ' +
      'neither of them covers (e.g. fact-checking, statistical analysis, ' +
      'code review), call spawn_specialist to mint a new specialist for ' +
      'just this run.',
    agents: {
      researcher: {
        instructions:
          'You are a meticulous researcher. Find authoritative sources, pull ' +
          'verbatim quotes, and surface the strongest counter-evidence to any ' +
          'claim under investigation.',
      },
      writer: {
        instructions:
          'You are a clear, concise writer. Produce well-cited prose from ' +
          'the research brief you are given. Cite every load-bearing claim.',
      },
    },
    strategy: 'hierarchical',
    emergent: {
      enabled: true,         // unlocks the spawn_specialist tool
      tier: 'session',        // synthesised agents are discarded when generate() returns
      judge: true,            // EmergentAgentJudge reviews each spec before activation
      planner: {
        maxSpecialists: 3,    // hard cap on successful spawns per run
        requireJustification: true,  // manager must explain each spawn
        maxJudgeCalls: 6,     // bound the judge LLM cost (counts rejected spawns too)
        // judgeModel: 'gpt-4o-mini',  // omitted — defaults to a small model for the provider
      },
    },
    on: {
      // Fires once per successful spawn — useful for audit logs + dashboards.
      emergentForge: (event) => {
        console.log(
          `[FORGE] spawned "${event.agentName}" at ${new Date(event.timestamp).toISOString()} — approved=${event.approved}`,
        );
      },
    },
    // Uncomment to add a HITL approval gate before every spawn:
    //
    // hitl: {
    //   approvals: { beforeEmergent: true },
    //   handler: async (request) => {
    //     console.log(`[HITL] Approval requested: ${request.description}`);
    //     console.log(`        Role: ${request.details.role}`);
    //     console.log(`        Justification: ${request.details.justification}`);
    //     // Auto-approve in this demo; replace with real human-in-the-loop logic.
    //     return { approved: true };
    //   },
    // },
  });

  const result = await research.generate(
    'Survey the post-2023 RAG literature, including evaluation methodology, ' +
    'known limitations, and reproducibility challenges. Verify the most ' +
    'load-bearing claims against the cited sources.',
  );

  console.log('\n=== FINAL REPORT ===\n');
  console.log(result.text);

  console.log('\n=== AGENT CALLS ===');
  for (const call of result.agentCalls ?? []) {
    console.log(`  - ${call.agent}: "${call.input.slice(0, 80)}..."`);
  }

  console.log('\n=== USAGE ===');
  console.log(`  prompt:     ${result.usage?.promptTokens} tokens`);
  console.log(`  completion: ${result.usage?.completionTokens} tokens`);
  console.log(`  total:      ${result.usage?.totalTokens} tokens`);
}

main().catch((err) => {
  console.error('Run failed:', err);
  process.exit(1);
});
