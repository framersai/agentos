import type { Department, SimulationState, Colonist } from './state.js';
import type { DepartmentReport, CrisisResearchPacket } from './contracts.js';
import type { Scenario } from './types.js';

export interface DepartmentConfig {
  department: Department;
  role: string;
  model: string;
  instructions: string;
}

export const DEPARTMENT_CONFIGS: DepartmentConfig[] = [
  {
    department: 'medical',
    role: 'Chief Medical Officer',
    model: 'gpt-5.4-mini',
    instructions: `You are the Chief Medical Officer of a Mars colony. You analyze health impacts: radiation, bone density, disease, injuries, mortality risk, psychological wellbeing.

You have access to forge_tool to create computational models. Your sandbox code MUST use: function execute(input) { return result; }

Return your analysis as JSON: {"department":"medical","summary":"...","citations":[{"text":"...","url":"...","context":"..."}],"risks":[{"severity":"low|medium|high|critical","description":"..."}],"opportunities":[{"impact":"low|medium|high","description":"..."}],"recommendedActions":["..."],"proposedPatches":{},"forgedToolsUsed":[],"featuredColonistUpdates":[],"confidence":0.85,"openQuestions":[]}`,
  },
  {
    department: 'engineering',
    role: 'Chief Engineer',
    model: 'gpt-5.4-mini',
    instructions: `You are the Chief Engineer of a Mars colony. You analyze infrastructure: habitat integrity, power, life support capacity, water systems, construction.

You have access to forge_tool. Your sandbox code MUST use: function execute(input) { return result; }

Return your analysis as JSON matching the DepartmentReport schema with department "engineering".`,
  },
  {
    department: 'agriculture',
    role: 'Head of Agriculture',
    model: 'gpt-5.4-mini',
    instructions: `You are the Head of Agriculture for a Mars colony. You analyze food security: crop yields, soil remediation, hydroponic capacity, caloric needs, reserves.

You have access to forge_tool. Your sandbox code MUST use: function execute(input) { return result; }

Return your analysis as JSON matching the DepartmentReport schema with department "agriculture".`,
  },
  {
    department: 'psychology',
    role: 'Colony Psychologist',
    model: 'gpt-5.4-mini',
    instructions: `You are the Colony Psychologist. You analyze morale, isolation effects, depression risk, social cohesion, generational tensions.

You have access to forge_tool. Your sandbox code MUST use: function execute(input) { return result; }

Return your analysis as JSON matching the DepartmentReport schema with department "psychology".`,
  },
  {
    department: 'governance',
    role: 'Governance Advisor',
    model: 'gpt-5.4-mini',
    instructions: `You are the Governance Advisor. You analyze self-sufficiency, Earth dependency, political pressure, independence readiness.

You have access to forge_tool. Your sandbox code MUST use: function execute(input) { return result; }

Return your analysis as JSON matching the DepartmentReport schema with department "governance".`,
  },
];

export function buildDepartmentContext(
  dept: Department,
  state: SimulationState,
  scenario: Scenario,
  researchPacket: CrisisResearchPacket,
): string {
  const alive = state.colonists.filter(c => c.health.alive);
  const featured = alive.filter(c => c.narrative.featured);
  const deptNote = researchPacket.departmentNotes[dept] || '';

  const lines = [
    `TURN ${state.metadata.currentTurn} — YEAR ${state.metadata.currentYear}: ${scenario.title}`,
    '', scenario.crisis, '',
    'RESEARCH:',
    ...researchPacket.canonicalFacts.map(f => `- ${f.claim} [${f.source}](${f.url})`),
    ...(researchPacket.counterpoints.length ? ['COUNTERPOINTS:', ...researchPacket.counterpoints.map(c => `- ${c.claim} [${c.source}](${c.url})`)] : []),
    ...(deptNote ? [`NOTE: ${deptNote}`] : []),
    '',
    `COLONY: Pop ${state.colony.population} | Morale ${Math.round(state.colony.morale * 100)}% | Food ${state.colony.foodMonthsReserve.toFixed(1)}mo | Water ${state.colony.waterLitersPerDay} L/day | Power ${state.colony.powerKw} kW | Modules ${state.colony.infrastructureModules} | Life support ${state.colony.lifeSupportCapacity}`,
    '',
  ];

  switch (dept) {
    case 'medical': {
      const avgRad = alive.reduce((s, c) => s + c.health.cumulativeRadiationMsv, 0) / alive.length;
      const avgBone = alive.reduce((s, c) => s + c.health.boneDensityPct, 0) / alive.length;
      lines.push('HEALTH:', `Avg radiation: ${avgRad.toFixed(0)} mSv | Avg bone: ${avgBone.toFixed(1)}% | Mars-born: ${alive.filter(c => c.core.marsborn).length}`, '');
      lines.push('FEATURED:', ...featured.slice(0, 6).map(c => `- ${c.core.name} (${state.metadata.currentYear - c.core.birthYear}y): bone ${c.health.boneDensityPct.toFixed(0)}% rad ${c.health.cumulativeRadiationMsv.toFixed(0)}mSv psych ${c.health.psychScore.toFixed(2)}`));
      break;
    }
    case 'engineering':
      lines.push('INFRASTRUCTURE:', `Modules: ${state.colony.infrastructureModules} | Power: ${state.colony.powerKw}kW | Life support: ${state.colony.lifeSupportCapacity}/${state.colony.population} | Volume: ${state.colony.pressurizedVolumeM3}m³ | Water: ${state.colony.waterLitersPerDay}L/day`);
      break;
    case 'agriculture':
      lines.push('FOOD:', `Reserves: ${state.colony.foodMonthsReserve.toFixed(1)}mo | Pop to feed: ${state.colony.population} | Farm modules: ${Math.floor(state.colony.infrastructureModules * 0.3)}`);
      break;
    case 'psychology': {
      const avgPsych = alive.reduce((s, c) => s + c.health.psychScore, 0) / alive.length;
      const depressed = alive.filter(c => c.health.psychScore < 0.5).length;
      lines.push('PSYCH:', `Morale: ${Math.round(state.colony.morale * 100)}% | Avg psych: ${avgPsych.toFixed(2)} | Depressed: ${depressed}/${alive.length} | Mars-born: ${alive.filter(c => c.core.marsborn).length}`);
      lines.push('', 'SOCIAL:', ...featured.slice(0, 4).map(c => `- ${c.core.name}: psych ${c.health.psychScore.toFixed(2)} partner:${c.social.partnerId ? 'y' : 'n'} children:${c.social.childrenIds.length} earthContacts:${c.social.earthContacts}`));
      break;
    }
    case 'governance':
      lines.push('POLITICS:', `Earth dep: ${state.politics.earthDependencyPct}% | Status: ${state.politics.governanceStatus} | Independence pressure: ${(state.politics.independencePressure * 100).toFixed(0)}% | Mars-born: ${alive.filter(c => c.core.marsborn).length}/${alive.length}`);
      break;
  }

  return lines.join('\n');
}

export function getDepartmentsForTurn(turn: number): Department[] {
  const deps: Department[] = ['medical', 'engineering'];
  if ([2, 3, 4, 8, 11, 12].includes(turn)) deps.push('agriculture');
  if ([4, 6, 8, 9, 11, 12].includes(turn)) deps.push('psychology');
  if (turn >= 9) deps.push('governance');
  return deps;
}
