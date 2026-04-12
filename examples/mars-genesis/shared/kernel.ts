import type { SimulationState, Colonist, TurnEvent } from './state.js';
import type { ColonySystems, ColonyPolitics } from './state.js';
import { SeededRng } from './rng.js';
import { generateInitialPopulation, type KeyPersonnel } from './colonist-generator.js';
import { progressBetweenTurns } from './progression.js';
import { SCENARIOS } from './scenarios.js';

export interface ColonyPatch {
  colony?: Partial<ColonySystems>;
  politics?: Partial<ColonyPolitics>;
  colonistUpdates?: Array<{
    colonistId: string;
    health?: Partial<Colonist['health']>;
    career?: Partial<Colonist['career']>;
  }>;
}

export interface PolicyEffect {
  description: string;
  patches: ColonyPatch;
  events: TurnEvent[];
}

export class SimulationKernel {
  private state: SimulationState;
  private rng: SeededRng;

  constructor(seed: number, leaderId: string, keyPersonnel: KeyPersonnel[]) {
    this.rng = new SeededRng(seed);
    const colonists = generateInitialPopulation(seed, 2035, keyPersonnel);

    this.state = {
      metadata: {
        simulationId: `mars-genesis-${seed}-${Date.now()}`,
        leaderId, seed,
        startYear: 2035, currentYear: 2035, currentTurn: 0,
      },
      colony: {
        population: colonists.length,
        powerKw: 400, foodMonthsReserve: 18, waterLitersPerDay: 800,
        pressurizedVolumeM3: 3000, lifeSupportCapacity: 120,
        infrastructureModules: 3, scienceOutput: 0, morale: 0.85,
      },
      colonists,
      politics: { earthDependencyPct: 95, governanceStatus: 'earth-governed', independencePressure: 0.05 },
      eventLog: [],
    };
  }

  getState(): SimulationState { return structuredClone(this.state); }

  getScenario(turn: number) { return SCENARIOS[turn - 1] ?? null; }

  getFeaturedColonists(): Colonist[] {
    return this.state.colonists.filter(c => c.narrative.featured && c.health.alive);
  }

  getAliveColonists(): Colonist[] {
    return this.state.colonists.filter(c => c.health.alive);
  }

  getAliveCount(): number {
    return this.state.colonists.filter(c => c.health.alive).length;
  }

  getDepartmentSummary(dept: string) {
    const m = this.state.colonists.filter(c => c.health.alive && c.core.department === dept);
    if (!m.length) return { count: 0, avgMorale: 0, avgBoneDensity: 0, avgRadiation: 0 };
    return {
      count: m.length,
      avgMorale: m.reduce((s, c) => s + c.health.psychScore, 0) / m.length,
      avgBoneDensity: m.reduce((s, c) => s + c.health.boneDensityPct, 0) / m.length,
      avgRadiation: m.reduce((s, c) => s + c.health.cumulativeRadiationMsv, 0) / m.length,
    };
  }

  /** Apply a policy effect from the commander's decision. */
  applyPolicy(effect: PolicyEffect): void {
    const { patches, events } = effect;

    if (patches.colony) {
      const c = this.state.colony;
      for (const [k, v] of Object.entries(patches.colony)) {
        if (v !== undefined && k in c) (c as any)[k] = v;
      }
      c.population = Math.max(0, c.population);
      c.morale = Math.max(0, Math.min(1, c.morale));
      c.foodMonthsReserve = Math.max(0, c.foodMonthsReserve);
      c.powerKw = Math.max(0, c.powerKw);
    }

    if (patches.politics) {
      const p = this.state.politics;
      for (const [k, v] of Object.entries(patches.politics)) {
        if (v !== undefined && k in p) (p as any)[k] = v;
      }
      p.earthDependencyPct = Math.max(0, Math.min(100, p.earthDependencyPct));
      p.independencePressure = Math.max(0, Math.min(1, p.independencePressure));
    }

    if (patches.colonistUpdates) {
      for (const u of patches.colonistUpdates) {
        const col = this.state.colonists.find(c => c.core.id === u.colonistId);
        if (!col) continue;
        if (u.health) Object.assign(col.health, u.health);
        if (u.career) Object.assign(col.career, u.career);
      }
    }

    this.state.eventLog.push(...events);
  }

  /** Advance to the next turn. Runs between-turn progression. */
  advanceTurn(nextTurn: number): SimulationState {
    const scenario = this.getScenario(nextTurn);
    if (!scenario) throw new Error(`No scenario for turn ${nextTurn}`);

    const yearDelta = scenario.year - this.state.metadata.currentYear;
    const turnRng = this.rng.turnSeed(nextTurn);

    const { state: progressed, events } = progressBetweenTurns(this.state, yearDelta, turnRng);
    this.state = progressed;
    this.state.metadata.currentYear = scenario.year;
    this.state.metadata.currentTurn = nextTurn;
    this.state.colony.population = this.getAliveCount();
    this.updateFeaturedColonists(events);

    return this.getState();
  }

  private updateFeaturedColonists(recentEvents: TurnEvent[]): void {
    const eventIds = new Set(recentEvents.filter(e => e.colonistId).map(e => e.colonistId!));
    for (const c of this.state.colonists) {
      if (eventIds.has(c.core.id) && c.health.alive) c.narrative.featured = true;
    }
    const featured = this.state.colonists.filter(c => c.narrative.featured && c.health.alive);
    if (featured.length > 16) {
      const sorted = featured.sort((a, b) => b.narrative.lifeEvents.length - a.narrative.lifeEvents.length);
      for (let i = 16; i < sorted.length; i++) sorted[i].narrative.featured = false;
    }
  }

  export(): SimulationState { return structuredClone(this.state); }
}
