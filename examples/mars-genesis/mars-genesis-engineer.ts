/**
 * Mars Genesis: Commander Dietrich Voss — "The Engineer"
 *
 * 50-year Mars colonization simulation driven by a high-conscientiousness,
 * low-openness HEXACO personality. Forges safety and measurement tools.
 * Researches real Mars science with citations.
 *
 * Run:
 *   cd packages/agentos
 *   ANTHROPIC_API_KEY=... SERPER_API_KEY=... npx tsx examples/mars-genesis/mars-genesis-engineer.ts
 *
 * Smoke test (3 turns only):
 *   ANTHROPIC_API_KEY=... SERPER_API_KEY=... npx tsx examples/mars-genesis/mars-genesis-engineer.ts 3
 */

import { ENGINEER } from './shared/constants.js';
import { runSimulation } from './shared/runner.js';

const maxTurns = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;

runSimulation(ENGINEER, maxTurns).catch((err) => {
  console.error('Simulation failed:', err);
  process.exitCode = 1;
});
