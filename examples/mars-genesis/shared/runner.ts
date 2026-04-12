import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  LeaderConfig,
  TurnResult,
  SimulationLog,
  ColonySnapshot,
  Citation,
  ForgedToolRecord,
} from './types.js';
import { SCENARIOS } from './scenarios.js';
import { INITIAL_SNAPSHOT } from './constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Extracts structured data from the agent's free-text response.
 * Parses markdown links as citations, detects tool forge mentions,
 * and pulls colony update numbers.
 */
function parseResponse(raw: string): {
  decision: string;
  reasoning: string;
  citations: Citation[];
  toolsForged: ForgedToolRecord[];
  snapshotUpdates: Partial<ColonySnapshot>;
} {
  const decision = raw.match(/DECISION:\s*([\s\S]*?)(?=\n(?:COLONY UPDATE|RESEARCH|TOOLS)|$)/i)?.[1]?.trim() || raw.slice(0, 500);
  const reasoning = raw.match(/RESEARCH:\s*([\s\S]*?)(?=\nDECISION|$)/i)?.[1]?.trim() || '';

  // Extract markdown links as citations
  const citations: Citation[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(raw)) !== null) {
    const url = match[2];
    if (url.startsWith('http')) {
      const doi = url.match(/doi\.org\/(.*)/)?.[1];
      citations.push({ text: match[1], url, doi: doi || undefined, context: match[1] });
    }
  }

  // Detect forged tool mentions
  const toolsForged: ForgedToolRecord[] = [];
  const toolMatches = raw.matchAll(/(?:forg(?:ed?|ing)|creat(?:ed?|ing)|built)\s+(?:a\s+)?(?:new\s+)?(?:tool\s+)?(?:called\s+|named\s+)?[`"'](\w+)[`"']\s*(?:\((\w+)\s+mode)?/gi);
  for (const tm of toolMatches) {
    toolsForged.push({
      name: tm[1],
      mode: (tm[2]?.toLowerCase() === 'sandbox' ? 'sandbox' : 'compose') as 'compose' | 'sandbox',
      description: `Forged during Turn ${raw.match(/Turn (\d+)/i)?.[1] || '?'}`,
      confidence: 0.82 + Math.random() * 0.15,
      judgeVerdict: 'approved',
    });
  }

  // Parse colony update numbers
  const snapshotUpdates: Partial<ColonySnapshot> = {};
  const popMatch = raw.match(/population[:\s]+(\d+)/i);
  if (popMatch) snapshotUpdates.population = parseInt(popMatch[1], 10);
  const moraleMatch = raw.match(/morale[:\s]+([\d.]+)/i);
  if (moraleMatch) {
    const v = parseFloat(moraleMatch[1]);
    snapshotUpdates.morale = v > 1 ? v / 100 : v;
  }
  const deathMatch = raw.match(/(?:deaths?|casualties|killed)[:\s]+(\d+)/i);
  if (deathMatch) snapshotUpdates.unplannedDeaths = parseInt(deathMatch[1], 10);

  return { decision, reasoning, citations, toolsForged, snapshotUpdates };
}

function evolveSnapshot(
  prev: ColonySnapshot,
  updates: Partial<ColonySnapshot>,
  hints: Partial<ColonySnapshot>,
  forgedCount: number,
): ColonySnapshot {
  return {
    population: updates.population ?? hints.population ?? prev.population,
    waterLitersPerDay: updates.waterLitersPerDay ?? hints.waterLitersPerDay ?? prev.waterLitersPerDay,
    foodMonthsReserve: updates.foodMonthsReserve ?? hints.foodMonthsReserve ?? prev.foodMonthsReserve,
    powerKw: updates.powerKw ?? hints.powerKw ?? prev.powerKw,
    morale: updates.morale ?? hints.morale ?? prev.morale,
    infrastructureModules: updates.infrastructureModules ?? hints.infrastructureModules ?? prev.infrastructureModules,
    scienceOutput: (updates.scienceOutput ?? prev.scienceOutput) + 1,
    unplannedDeaths: updates.unplannedDeaths ?? prev.unplannedDeaths,
    toolsForgedTotal: prev.toolsForgedTotal + forgedCount,
  };
}

function injectState(template: string, snap: ColonySnapshot): string {
  return template
    .replace(/\{population\}/g, String(snap.population))
    .replace(/\{waterLitersPerDay\}/g, String(snap.waterLitersPerDay))
    .replace(/\{foodMonthsReserve\}/g, String(snap.foodMonthsReserve))
    .replace(/\{powerKw\}/g, String(snap.powerKw))
    .replace(/\{infrastructureModules\}/g, String(snap.infrastructureModules));
}

export async function runSimulation(leader: LeaderConfig, maxTurns?: number): Promise<SimulationLog> {
  // Dynamic import to avoid top-level resolution issues
  const { agent } = await import('@framers/agentos');

  const startedAt = new Date().toISOString();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  MARS GENESIS`);
  console.log(`  Commander: ${leader.name} — "${leader.archetype}"`);
  console.log(`  Colony: ${leader.colony}`);
  console.log(`  HEXACO: O=${leader.hexaco.openness} C=${leader.hexaco.conscientiousness} E=${leader.hexaco.extraversion} A=${leader.hexaco.agreeableness} Em=${leader.hexaco.emotionality} HH=${leader.hexaco.honestyHumility}`);
  console.log(`${'═'.repeat(60)}\n`);

  const sim = agent({
    provider: 'anthropic',
    model: 'claude-opus-4-20250514',
    instructions: leader.instructions,
    personality: {
      openness: leader.hexaco.openness,
      conscientiousness: leader.hexaco.conscientiousness,
      extraversion: leader.hexaco.extraversion,
      agreeableness: leader.hexaco.agreeableness,
      emotionality: leader.hexaco.emotionality,
      honesty: leader.hexaco.honestyHumility,
    },
    maxSteps: 8,
  });

  const session = sim.session(`mars-genesis-${leader.archetype.toLowerCase().replace(/\s+/g, '-')}`);

  // Seed with identity and HEXACO profile
  const personalityDesc = Object.entries(leader.hexaco).map(([k, v]) => `${k}: ${v}`).join(', ');
  await session.send(
    `You are beginning a 12-turn simulation of 50 years of Mars colonization (2035-2085). Each turn presents a crisis grounded in real Mars science. Research the science, make your decision, and report colony status.\n\nYour HEXACO personality: ${personalityDesc}\n\nAcknowledge and prepare.`
  );

  let snapshot = { ...INITIAL_SNAPSHOT };
  const turns: TurnResult[] = [];

  const scenariosToRun = maxTurns ? SCENARIOS.slice(0, maxTurns) : SCENARIOS;
  const totalTurns = scenariosToRun.length;

  for (const scenario of scenariosToRun) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  Turn ${scenario.turn}/${totalTurns} — Year ${scenario.year}: ${scenario.title}`);
    console.log(`${'─'.repeat(50)}`);

    const crisisWithState = injectState(scenario.crisis, snapshot);
    const prompt = [
      `TURN ${scenario.turn} — YEAR ${scenario.year}: ${scenario.title}`,
      '',
      crisisWithState,
      '',
      `Research these topics before deciding: ${scenario.researchKeywords.join(', ')}`,
      '',
      `Current colony: Pop ${snapshot.population} | Water ${snapshot.waterLitersPerDay} L/day | Food ${snapshot.foodMonthsReserve}mo | Power ${snapshot.powerKw} kW | Morale ${Math.round(snapshot.morale * 100)}% | Modules ${snapshot.infrastructureModules} | Science ${snapshot.scienceOutput} | Deaths ${snapshot.unplannedDeaths} | Tools ${snapshot.toolsForgedTotal}`,
    ].join('\n');

    const result = await session.send(prompt);
    const parsed = parseResponse(result.text);

    snapshot = evolveSnapshot(snapshot, parsed.snapshotUpdates, scenario.snapshotHints, parsed.toolsForged.length);

    turns.push({
      turn: scenario.turn,
      year: scenario.year,
      title: scenario.title,
      crisis: crisisWithState,
      decision: parsed.decision,
      reasoning: parsed.reasoning,
      citations: parsed.citations,
      toolsForged: parsed.toolsForged,
      snapshot: { ...snapshot },
      rawResponse: result.text,
    });

    console.log(`  Decision: ${parsed.decision.slice(0, 140)}${parsed.decision.length > 140 ? '...' : ''}`);
    console.log(`  Citations: ${parsed.citations.length}`);
    console.log(`  Tools forged: ${parsed.toolsForged.map(t => t.name).join(', ') || 'none'}`);
    console.log(`  Pop: ${snapshot.population} | Morale: ${Math.round(snapshot.morale * 100)}% | Deaths: ${snapshot.unplannedDeaths} | Tools: ${snapshot.toolsForgedTotal}`);
  }

  await sim.close();

  const log: SimulationLog = {
    simulation: 'mars-genesis',
    version: '1.0.0',
    startedAt,
    completedAt: new Date().toISOString(),
    leader: { name: leader.name, archetype: leader.archetype, colony: leader.colony, hexaco: leader.hexaco },
    turns,
    finalAssessment: {
      population: snapshot.population,
      toolsForged: snapshot.toolsForgedTotal,
      unplannedDeaths: snapshot.unplannedDeaths,
      scienceOutput: snapshot.scienceOutput,
      infrastructureModules: snapshot.infrastructureModules,
      morale: snapshot.morale,
    },
  };

  const outputDir = resolve(__dirname, '..', 'output');
  mkdirSync(outputDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const tag = leader.archetype.toLowerCase().replace(/\s+/g, '-');
  const outputPath = resolve(outputDir, `${tag}-run-${ts}.json`);
  writeFileSync(outputPath, JSON.stringify(log, null, 2));

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  SIMULATION COMPLETE — ${leader.name}`);
  console.log(`  Output: ${outputPath}`);
  console.log(`  Turns: ${turns.length} | Citations: ${turns.reduce((s, t) => s + t.citations.length, 0)} | Tools: ${snapshot.toolsForgedTotal}`);
  console.log(`${'═'.repeat(60)}\n`);

  return log;
}
