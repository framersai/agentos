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
 */

import { ENGINEER } from './shared/constants.js';
import { runSimulation } from './shared/runner.js';

runSimulation(ENGINEER).catch((err) => {
  console.error('Simulation failed:', err);
  process.exitCode = 1;
});
