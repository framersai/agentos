/**
 * Mars Genesis: Commander Aria Chen — "The Visionary"
 *
 * 50-year Mars colonization simulation driven by a high-openness,
 * low-conscientiousness HEXACO personality. Forges growth and
 * exploration tools. Researches real Mars science with citations.
 *
 * Run:
 *   cd packages/agentos
 *   ANTHROPIC_API_KEY=... SERPER_API_KEY=... npx tsx examples/mars-genesis/mars-genesis-visionary.ts
 */

import { VISIONARY } from './shared/constants.js';
import { runSimulation } from './shared/runner.js';

runSimulation(VISIONARY).catch((err) => {
  console.error('Simulation failed:', err);
  process.exitCode = 1;
});
