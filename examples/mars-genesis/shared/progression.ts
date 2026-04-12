import type { Colonist, ColonySystems, TurnEvent, SimulationState, HexacoProfile, TurnOutcome } from './state.js';
import { HEXACO_TRAITS } from './state.js';
import { SeededRng } from './rng.js';

const MARS_RADIATION_MSV_PER_YEAR = 0.67 * 365; // ~244.55 mSv/year

// Trait activation profiles per department role (Tett & Burnett 2003)
const ROLE_ACTIVATIONS: Record<string, Partial<HexacoProfile>> = {
  medical:     { conscientiousness: 0.7, emotionality: 0.6, agreeableness: 0.6 },
  engineering: { conscientiousness: 0.9, openness: 0.3 },
  agriculture: { conscientiousness: 0.6, agreeableness: 0.7, openness: 0.5 },
  psychology:  { agreeableness: 0.8, emotionality: 0.7, openness: 0.6 },
  governance:  { extraversion: 0.7, honestyHumility: 0.6 },
};

export { ROLE_ACTIVATIONS };

/**
 * Apply personality drift to all promoted colonists. Deterministic from inputs.
 * Three forces: leader pull, role pull, outcome pull.
 */
export function applyPersonalityDrift(
  colonists: Colonist[],
  commanderHexaco: HexacoProfile,
  turnOutcome: TurnOutcome | null,
  yearDelta: number,
  turn: number,
  year: number,
): void {
  for (const c of colonists) {
    if (!c.health.alive || !c.promotion) continue;

    const dept = c.promotion.department;
    const activation = ROLE_ACTIVATIONS[dept] ?? {};

    for (const trait of HEXACO_TRAITS) {
      let pull = 0;

      // Leader pull: traits converge toward commander (Van Iddekinge 2023)
      pull += (commanderHexaco[trait] - c.hexaco[trait]) * 0.02;

      // Role pull: department role activates specific traits (Tett & Burnett 2003)
      if (activation[trait] !== undefined) {
        pull += (activation[trait]! - c.hexaco[trait]) * 0.01;
      }

      // Outcome pull: success/failure reinforces or punishes traits
      if (turnOutcome) {
        if (trait === 'openness') {
          if (turnOutcome === 'risky_success') pull += 0.03;
          if (turnOutcome === 'risky_failure') pull -= 0.04;
          if (turnOutcome === 'conservative_failure') pull += 0.02;
        }
        if (trait === 'conscientiousness') {
          if (turnOutcome === 'risky_failure') pull += 0.03;
          if (turnOutcome === 'conservative_success') pull += 0.02;
        }
      }

      // Rate cap and bounds
      const delta = Math.max(-0.05, Math.min(0.05, pull)) * yearDelta;
      c.hexaco[trait] = Math.max(0.05, Math.min(0.95, c.hexaco[trait] + delta));
    }

    c.hexacoHistory.push({ turn, year, hexaco: { ...c.hexaco } });
  }
}

/**
 * Classify turn outcome as risky/conservative success/failure.
 * Deterministic from seed + decision text.
 */
export function classifyOutcome(
  decisionText: string,
  riskyOption: string,
  riskSuccessProbability: number,
  colony: ColonySystems,
  rng: SeededRng,
): TurnOutcome {
  const isRisky = decisionText.toLowerCase().includes(riskyOption.toLowerCase());

  let prob = riskSuccessProbability;
  if (colony.morale > 0.7) prob += 0.1;
  if (colony.foodMonthsReserve > 12) prob += 0.05;
  if (colony.population > 150) prob -= 0.05;
  prob = Math.max(0.1, Math.min(0.9, prob));

  const success = rng.chance(prob);

  if (isRisky && success) return 'risky_success';
  if (isRisky && !success) return 'risky_failure';
  if (!isRisky && success) return 'conservative_success';
  return 'conservative_failure';
}

/**
 * Run all between-turn progression: aging, mortality, births, careers,
 * health degradation, resource production. All deterministic from seed.
 */
export function progressBetweenTurns(
  state: SimulationState,
  yearDelta: number,
  turnRng: SeededRng,
): { state: SimulationState; events: TurnEvent[] } {
  const events: TurnEvent[] = [];
  const year = state.metadata.currentYear;
  const turn = state.metadata.currentTurn;
  let colonists = state.colonists.map(c => structuredClone(c));
  let colony = structuredClone(state.colony);

  // 1. Age all colonists and accumulate radiation
  for (const c of colonists) {
    if (!c.health.alive) continue;
    c.career.yearsExperience += yearDelta;
    c.health.cumulativeRadiationMsv += MARS_RADIATION_MSV_PER_YEAR * yearDelta;

    // Bone density loss (stabilizes after ~20 years on Mars)
    const lossRate = c.core.marsborn ? 0.003 : 0.005;
    const yearsOnMars = year - (c.core.marsborn ? c.core.birthYear : 2035);
    const decayFactor = Math.max(0.5, 1 - lossRate * Math.min(yearsOnMars, 20));
    c.health.boneDensityPct = Math.max(50, c.health.boneDensityPct * decayFactor);

    // Earth contacts decay
    if (c.social.earthContacts > 0 && turnRng.chance(0.15 * yearDelta)) {
      c.social.earthContacts = Math.max(0, c.social.earthContacts - 1);
    }
  }

  // 2. Natural mortality
  for (const c of colonists) {
    if (!c.health.alive) continue;
    const age = year - c.core.birthYear;
    if (age < 60) continue;

    let mortalityProb = 0;
    if (age >= 60) mortalityProb = 0.01 * yearDelta;
    if (age >= 70) mortalityProb = 0.03 * yearDelta;
    if (age >= 80) mortalityProb = 0.08 * yearDelta;
    if (age >= 90) mortalityProb = 0.20 * yearDelta;

    if (c.health.cumulativeRadiationMsv > 1000) mortalityProb += 0.02 * yearDelta;
    if (c.health.cumulativeRadiationMsv > 2000) mortalityProb += 0.05 * yearDelta;

    if (turnRng.chance(Math.min(mortalityProb, 0.5))) {
      c.health.alive = false;
      c.health.deathYear = year;
      c.health.deathCause = age >= 80 ? 'natural causes' : 'age-related complications';
      c.narrative.lifeEvents.push({ year, event: `Died at age ${age} (${c.health.deathCause})`, source: 'kernel' });
      events.push({ turn, year, type: 'death', description: `${c.core.name} died at age ${age}`, colonistId: c.core.id });
    }
  }

  // 3. Births
  const aliveAdults = colonists.filter(c => c.health.alive && (year - c.core.birthYear) >= 20 && (year - c.core.birthYear) <= 42);
  const birthProb = colony.morale > 0.4 && colony.foodMonthsReserve > 6 ? 0.08 * yearDelta : 0.02 * yearDelta;
  const potentialParents = aliveAdults.filter(c => c.social.childrenIds.length < 3);

  for (let i = 0; i < potentialParents.length - 1; i += 2) {
    if (turnRng.chance(birthProb)) {
      const p1 = potentialParents[i];
      const p2 = potentialParents[i + 1];
      const childName = `${turnRng.pick(['Nova', 'Kai', 'Sol', 'Tera', 'Eos', 'Zan', 'Lyra', 'Orion', 'Vega', 'Juno', 'Atlas', 'Iris', 'Clio', 'Pax', 'Io', 'Thea'])} ${p1.core.name.split(' ').pop()}`;
      const childId = `col-mars-${year}-${turnRng.int(1000, 9999)}`;
      // Child inherits blend of parents' traits with slight noise
      const childHexaco: any = {};
      for (const trait of ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'emotionality', 'honestyHumility'] as const) {
        childHexaco[trait] = Math.max(0.05, Math.min(0.95,
          (p1.hexaco[trait] + p2.hexaco[trait]) / 2 + turnRng.next() * 0.1 - 0.05
        ));
      }
      const child: Colonist = {
        core: { id: childId, name: childName, birthYear: year, marsborn: true, department: 'science', role: 'Child' },
        health: { alive: true, boneDensityPct: 88, cumulativeRadiationMsv: 0, psychScore: 0.9, conditions: [] },
        career: { specialization: 'Undetermined', yearsExperience: 0, rank: 'junior', achievements: ['Born on Mars'] },
        social: { childrenIds: [], friendIds: [], earthContacts: 0 },
        narrative: { lifeEvents: [{ year, event: `Born on Mars to ${p1.core.name} and ${p2.core.name}`, source: 'kernel' }], featured: false },
        hexaco: childHexaco,
        hexacoHistory: [{ turn, year, hexaco: { ...childHexaco } }],
      };
      p1.social.childrenIds.push(childId);
      p2.social.childrenIds.push(childId);
      p1.narrative.lifeEvents.push({ year, event: `Child born: ${childName}`, source: 'kernel' });
      p2.narrative.lifeEvents.push({ year, event: `Child born: ${childName}`, source: 'kernel' });
      colonists.push(child);
      events.push({ turn, year, type: 'birth', description: `${childName} born to ${p1.core.name} and ${p2.core.name}`, colonistId: childId });
    }
  }

  // 4. Career progression
  for (const c of colonists) {
    if (!c.health.alive) continue;
    const age = year - c.core.birthYear;

    // Mars-born children enter workforce at 18
    if (c.core.role === 'Child' && age >= 18) {
      c.core.department = turnRng.pick(['medical', 'engineering', 'agriculture', 'science'] as const);
      c.career.specialization = turnRng.pick(['General', 'Support', 'Research']);
      c.core.role = `Junior ${c.career.specialization} Specialist`;
      c.career.rank = 'junior';
      c.narrative.lifeEvents.push({ year, event: `Began career in ${c.core.department}`, source: 'kernel' });
    }

    if (age < 18) continue;

    if (c.career.rank === 'junior' && c.career.yearsExperience >= 5 && turnRng.chance(0.15 * yearDelta)) {
      c.career.rank = 'senior';
      c.narrative.lifeEvents.push({ year, event: `Promoted to Senior ${c.career.specialization}`, source: 'kernel' });
      events.push({ turn, year, type: 'promotion', description: `${c.core.name} promoted to senior`, colonistId: c.core.id });
    }
    if (c.career.rank === 'senior' && c.career.yearsExperience >= 12 && turnRng.chance(0.08 * yearDelta)) {
      c.career.rank = 'lead';
      c.narrative.lifeEvents.push({ year, event: `Promoted to Lead ${c.career.specialization}`, source: 'kernel' });
      events.push({ turn, year, type: 'promotion', description: `${c.core.name} promoted to lead`, colonistId: c.core.id });
    }
  }

  // 5. Morale drift
  const foodPressure = colony.foodMonthsReserve < 6 ? -0.05 : 0;
  const popPressure = colonists.filter(c => c.health.alive).length > colony.lifeSupportCapacity ? -0.08 : 0;
  colony.morale = Math.max(0, Math.min(1, colony.morale + (0.6 - colony.morale) * 0.1 + foodPressure + popPressure));

  // 6. Update population count
  colony.population = colonists.filter(c => c.health.alive).length;

  // 7. Resource production
  colony.foodMonthsReserve = Math.max(0, colony.foodMonthsReserve - (yearDelta * 0.5) + (colony.infrastructureModules * 0.3 * yearDelta));
  colony.scienceOutput += yearDelta;

  return {
    state: { ...state, colonists, colony, eventLog: [...state.eventLog, ...events] },
    events,
  };
}
