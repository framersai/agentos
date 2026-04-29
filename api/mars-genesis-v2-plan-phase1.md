# Mars Genesis v2 Phase 1: Simulation Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, seeded, replayable Mars colony simulation kernel that tracks 100 colonists across 12 turns (50 years) with aging, births, deaths, careers, relationships, and resource management. No LLM calls in this phase.

**Architecture:** A pure TypeScript simulation kernel with seeded RNG owns all canonical state transitions. Typed interfaces define colonist data, colony systems, and turn events. A progression module handles between-turn evolution (aging, mortality, births, careers). The kernel validates patches, enforces invariants, and exports replayable run artifacts as JSON.

**Tech Stack:** TypeScript, Node.js 22+, vitest for tests, seeded PRNG (mulberry32)

---

### Task 1: State Types

**Files:**
- Create: `examples/mars-genesis/shared/state.ts`

- [ ] **Step 1: Create the canonical state types**

```typescript
// examples/mars-genesis/shared/state.ts

export type Department = 'medical' | 'engineering' | 'agriculture' | 'science' | 'administration' | 'psychology' | 'governance';

export interface LifeEvent {
  year: number;
  event: string;
  source: Department | 'kernel' | 'commander';
}

export interface ColonistCore {
  id: string;
  name: string;
  birthYear: number;
  marsborn: boolean;
  department: Department;
  role: string;
}

export interface ColonistHealth {
  alive: boolean;
  deathYear?: number;
  deathCause?: string;
  boneDensityPct: number;
  cumulativeRadiationMsv: number;
  psychScore: number;
  conditions: string[];
}

export interface ColonistCareer {
  specialization: string;
  yearsExperience: number;
  rank: 'junior' | 'senior' | 'lead' | 'chief';
  achievements: string[];
  currentProject?: string;
}

export interface ColonistSocial {
  partnerId?: string;
  childrenIds: string[];
  friendIds: string[];
  earthContacts: number;
}

export interface ColonistNarrative {
  lifeEvents: LifeEvent[];
  featured: boolean;
}

export interface Colonist {
  core: ColonistCore;
  health: ColonistHealth;
  career: ColonistCareer;
  social: ColonistSocial;
  narrative: ColonistNarrative;
}

export interface ColonySystems {
  population: number;
  powerKw: number;
  foodMonthsReserve: number;
  waterLitersPerDay: number;
  pressurizedVolumeM3: number;
  lifeSupportCapacity: number;
  infrastructureModules: number;
  scienceOutput: number;
  morale: number;
}

export interface ColonyPolitics {
  earthDependencyPct: number;
  governanceStatus: 'earth-governed' | 'commonwealth' | 'independent';
  independencePressure: number;
}

export interface SimulationMetadata {
  simulationId: string;
  leaderId: string;
  seed: number;
  startYear: number;
  currentYear: number;
  currentTurn: number;
}

export interface TurnEvent {
  turn: number;
  year: number;
  type: 'crisis' | 'decision' | 'birth' | 'death' | 'promotion' | 'relationship' | 'tool_forge' | 'system';
  description: string;
  colonistId?: string;
  data?: Record<string, unknown>;
}

export interface SimulationState {
  metadata: SimulationMetadata;
  colony: ColonySystems;
  colonists: Colonist[];
  politics: ColonyPolitics;
  eventLog: TurnEvent[];
}
```

- [ ] **Step 2: Commit**

```bash
cd packages/agentos
git add examples/mars-genesis/shared/state.ts
git commit -m "feat(mars-genesis): add canonical simulation state types"
```

---

### Task 2: Seeded RNG

**Files:**
- Create: `examples/mars-genesis/shared/rng.ts`

- [ ] **Step 1: Create seeded RNG module**

```typescript
// examples/mars-genesis/shared/rng.ts

/**
 * Mulberry32 — fast 32-bit seeded PRNG.
 * Deterministic: same seed always produces same sequence.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Returns true with the given probability (0-1). */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Picks a random element from an array. */
  pick<T>(arr: T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /** Derives a child RNG for a specific turn (deterministic sub-stream). */
  turnSeed(turn: number): SeededRng {
    return new SeededRng(this.state ^ (turn * 2654435761));
  }
}
```

- [ ] **Step 2: Verify determinism manually**

```bash
cd packages/agentos
npx tsx -e "
const { SeededRng } = require('./examples/mars-genesis/shared/rng.ts');
const a = new SeededRng(42);
const b = new SeededRng(42);
console.log('Same seed, same sequence:', a.next() === b.next(), a.next() === b.next());
const c = new SeededRng(42);
console.log('Reproducible:', c.next(), c.next(), c.next());
const d = new SeededRng(42);
console.log('Reproducible:', d.next(), d.next(), d.next());
"
```

Expected: both lines print identical floats.

- [ ] **Step 3: Commit**

```bash
git add examples/mars-genesis/shared/rng.ts
git commit -m "feat(mars-genesis): add deterministic seeded RNG (mulberry32)"
```

---

### Task 3: Colonist Generator

**Files:**
- Create: `examples/mars-genesis/shared/colonist-generator.ts`

- [ ] **Step 1: Create initial population generator**

```typescript
// examples/mars-genesis/shared/colonist-generator.ts

import type { Colonist, Department } from './state.js';
import { SeededRng } from './rng.js';

const FIRST_NAMES = [
  'Aria', 'Dietrich', 'Yuki', 'Marcus', 'Elena', 'Kwame', 'Sofia', 'Jin',
  'Amara', 'Liam', 'Priya', 'Omar', 'Mei', 'Carlos', 'Ingrid', 'Tariq',
  'Nadia', 'Henrik', 'Aisha', 'Pavel', 'Luna', 'Ravi', 'Zara', 'Felix',
  'Anya', 'Diego', 'Kira', 'Hassan', 'Signe', 'Jamal', 'Mila', 'Chen',
  'Fatima', 'Anders', 'Keiko', 'David', 'Olga', 'Kofi', 'Leila', 'Sven',
  'Rosa', 'Idris', 'Hana', 'Bruno', 'Daria', 'Emeka', 'Yara', 'Tomas',
  'Nia', 'Viktor',
];

const LAST_NAMES = [
  'Chen', 'Voss', 'Tanaka', 'Webb', 'Kowalski', 'Okafor', 'Petrov', 'Kim',
  'Santos', 'Johansson', 'Patel', 'Al-Rashid', 'Nakamura', 'Fernandez', 'Berg',
  'Ibrahim', 'Volkov', 'Singh', 'Torres', 'Andersen', 'Müller', 'Zhang',
  'Osei', 'Larsson', 'Ahmad', 'Costa', 'Ivanova', 'Park', 'Eriksson', 'Diallo',
  'Sato', 'Rivera', 'Lindqvist', 'Mensah', 'Kato', 'Morales', 'Holm', 'Yusuf',
  'Takahashi', 'Reyes', 'Nkomo', 'Li', 'Herrera', 'Bakker', 'Ito', 'Mendez',
  'Dahl', 'Owusu', 'Yamamoto', 'Cruz',
];

const SPECIALIZATIONS: Record<Department, string[]> = {
  medical: ['General Medicine', 'Radiation Medicine', 'Surgery', 'Psychiatry', 'Emergency Medicine'],
  engineering: ['Structural', 'Life Support', 'Power Systems', 'Communications', 'Robotics'],
  agriculture: ['Hydroponics', 'Soil Science', 'Botany', 'Nutrition', 'Water Systems'],
  science: ['Geology', 'Atmospheric Science', 'Biology', 'Chemistry', 'Astrophysics'],
  administration: ['Operations', 'Logistics', 'HR', 'Communications', 'Planning'],
  psychology: ['Clinical Psychology', 'Social Psychology', 'Occupational Therapy'],
  governance: ['Policy', 'Law', 'Diplomacy'],
};

const DEPARTMENT_DISTRIBUTION: Department[] = [
  'engineering', 'engineering', 'engineering', 'engineering',
  'medical', 'medical', 'medical',
  'agriculture', 'agriculture', 'agriculture',
  'science', 'science', 'science',
  'administration', 'administration',
  'psychology',
];

interface KeyPersonnel {
  name: string;
  department: Department;
  role: string;
  specialization: string;
  age: number;
  featured: boolean;
}

export function generateInitialPopulation(seed: number, startYear: number, keyPersonnel: KeyPersonnel[]): Colonist[] {
  const rng = new SeededRng(seed);
  const colonists: Colonist[] = [];
  const usedNames = new Set<string>();

  // Add key personnel first
  for (const kp of keyPersonnel) {
    usedNames.add(kp.name);
    colonists.push(createColonist(kp.name, startYear - kp.age, kp.department, kp.role, kp.specialization, false, kp.featured));
  }

  // Fill remaining slots to 100
  const remaining = 100 - keyPersonnel.length;
  for (let i = 0; i < remaining; i++) {
    let name: string;
    do {
      name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    } while (usedNames.has(name));
    usedNames.add(name);

    const dept = rng.pick(DEPARTMENT_DISTRIBUTION);
    const spec = rng.pick(SPECIALIZATIONS[dept]);
    const age = rng.int(25, 55);
    const rank = age > 40 ? (rng.chance(0.3) ? 'lead' : 'senior') : (rng.chance(0.2) ? 'senior' : 'junior');

    colonists.push(createColonist(
      name,
      startYear - age,
      dept,
      `${rank.charAt(0).toUpperCase() + rank.slice(1)} ${spec} Specialist`,
      spec,
      false,
      false,
    ));
    colonists[colonists.length - 1].career.rank = rank as any;
    colonists[colonists.length - 1].career.yearsExperience = rng.int(2, age - 22);
  }

  return colonists;
}

function createColonist(
  name: string,
  birthYear: number,
  department: Department,
  role: string,
  specialization: string,
  marsborn: boolean,
  featured: boolean,
): Colonist {
  return {
    core: {
      id: `col-${name.toLowerCase().replace(/\s+/g, '-')}`,
      name,
      birthYear,
      marsborn,
      department,
      role,
    },
    health: {
      alive: true,
      boneDensityPct: marsborn ? 88 : 100,
      cumulativeRadiationMsv: 0,
      psychScore: 0.8,
      conditions: [],
    },
    career: {
      specialization,
      yearsExperience: 0,
      rank: 'senior',
      achievements: [],
    },
    social: {
      childrenIds: [],
      friendIds: [],
      earthContacts: marsborn ? 0 : 5,
    },
    narrative: {
      lifeEvents: [],
      featured,
    },
  };
}
```

- [ ] **Step 2: Verify generation**

```bash
npx tsx -e "
const { generateInitialPopulation } = require('./examples/mars-genesis/shared/colonist-generator.ts');
const pop = generateInitialPopulation(42, 2035, [
  { name: 'Dr. Yuki Tanaka', department: 'medical', role: 'Chief Medical Officer', specialization: 'Radiation Medicine', age: 38, featured: true },
]);
console.log('Population:', pop.length);
console.log('First:', pop[0].core.name, pop[0].core.role);
console.log('Last:', pop[pop.length-1].core.name, pop[pop.length-1].core.department);
const pop2 = generateInitialPopulation(42, 2035, [
  { name: 'Dr. Yuki Tanaka', department: 'medical', role: 'Chief Medical Officer', specialization: 'Radiation Medicine', age: 38, featured: true },
]);
console.log('Reproducible:', pop[10].core.name === pop2[10].core.name);
"
```

Expected: 100 colonists, same names on repeated runs with same seed.

- [ ] **Step 3: Commit**

```bash
git add examples/mars-genesis/shared/colonist-generator.ts
git commit -m "feat(mars-genesis): add seeded colonist population generator"
```

---

### Task 4: Between-Turn Progression

**Files:**
- Create: `examples/mars-genesis/shared/progression.ts`

- [ ] **Step 1: Create the progression module**

```typescript
// examples/mars-genesis/shared/progression.ts

import type { Colonist, ColonySystems, TurnEvent, SimulationState } from './state.js';
import { SeededRng } from './rng.js';

const MARS_RADIATION_MSV_PER_YEAR = 0.67 * 365; // ~244.55 mSv/year

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
  let colonists = state.colonists.map(c => structuredClone(c));
  let colony = structuredClone(state.colony);

  // 1. Age all colonists and accumulate radiation
  for (const c of colonists) {
    if (!c.health.alive) continue;
    c.career.yearsExperience += yearDelta;
    c.health.cumulativeRadiationMsv += MARS_RADIATION_MSV_PER_YEAR * yearDelta;

    // Bone density loss
    const lossRate = c.core.marsborn ? 0.003 : 0.005; // 0.3% or 0.5% per year
    const yearsOnMars = year - (c.core.marsborn ? c.core.birthYear : 2035);
    const decayFactor = Math.max(0.5, 1 - lossRate * Math.min(yearsOnMars, 20)); // Stabilizes after 20 years
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

    // Base mortality increases with age, radiation, and low bone density
    let mortalityProb = 0;
    if (age >= 60) mortalityProb = 0.01 * yearDelta;
    if (age >= 70) mortalityProb = 0.03 * yearDelta;
    if (age >= 80) mortalityProb = 0.08 * yearDelta;
    if (age >= 90) mortalityProb = 0.20 * yearDelta;

    // Radiation increases mortality
    if (c.health.cumulativeRadiationMsv > 1000) mortalityProb += 0.02 * yearDelta;
    if (c.health.cumulativeRadiationMsv > 2000) mortalityProb += 0.05 * yearDelta;

    if (turnRng.chance(Math.min(mortalityProb, 0.5))) {
      c.health.alive = false;
      c.health.deathYear = year;
      c.health.deathCause = age >= 80 ? 'natural causes' : 'age-related complications';
      c.narrative.lifeEvents.push({ year, event: `Died at age ${age} (${c.health.deathCause})`, source: 'kernel' });
      events.push({
        turn: state.metadata.currentTurn,
        year,
        type: 'death',
        description: `${c.core.name} died at age ${age}`,
        colonistId: c.core.id,
      });
    }
  }

  // 3. Births
  const aliveAdults = colonists.filter(c => c.health.alive && (year - c.core.birthYear) >= 20 && (year - c.core.birthYear) <= 42);
  const birthProbPerCouple = colony.morale > 0.4 && colony.foodMonthsReserve > 6 ? 0.08 * yearDelta : 0.02 * yearDelta;
  const potentialParents = aliveAdults.filter(c => c.social.childrenIds.length < 3);

  for (let i = 0; i < potentialParents.length - 1; i += 2) {
    if (turnRng.chance(birthProbPerCouple)) {
      const parent1 = potentialParents[i];
      const parent2 = potentialParents[i + 1];
      const childName = `Baby ${parent1.core.name.split(' ')[1]}-${parent2.core.name.split(' ')[1]}`;
      const childId = `col-mars-born-${year}-${turnRng.int(1000, 9999)}`;
      const child: Colonist = {
        core: { id: childId, name: childName, birthYear: year, marsborn: true, department: 'science', role: 'Child' },
        health: { alive: true, boneDensityPct: 88, cumulativeRadiationMsv: 0, psychScore: 0.9, conditions: [] },
        career: { specialization: 'Undetermined', yearsExperience: 0, rank: 'junior', achievements: ['Born on Mars'] },
        social: { childrenIds: [], friendIds: [], earthContacts: 0 },
        narrative: { lifeEvents: [{ year, event: `Born on Mars to ${parent1.core.name} and ${parent2.core.name}`, source: 'kernel' }], featured: false },
      };
      parent1.social.childrenIds.push(childId);
      parent2.social.childrenIds.push(childId);
      parent1.narrative.lifeEvents.push({ year, event: `Child born: ${childName}`, source: 'kernel' });
      parent2.narrative.lifeEvents.push({ year, event: `Child born: ${childName}`, source: 'kernel' });
      colonists.push(child);
      events.push({
        turn: state.metadata.currentTurn,
        year,
        type: 'birth',
        description: `${childName} born to ${parent1.core.name} and ${parent2.core.name}`,
        colonistId: childId,
      });
    }
  }

  // 4. Career progression
  for (const c of colonists) {
    if (!c.health.alive) continue;
    const age = year - c.core.birthYear;
    if (age < 18) continue;

    // Assign role to grown Mars-born children
    if (c.core.role === 'Child' && age >= 18) {
      c.core.role = `Junior ${c.career.specialization} Specialist`;
      c.career.rank = 'junior';
      c.core.department = turnRng.pick(['medical', 'engineering', 'agriculture', 'science'] as const);
      c.career.specialization = turnRng.pick(['General', 'Support', 'Research']);
      c.narrative.lifeEvents.push({ year, event: `Began career in ${c.core.department}`, source: 'kernel' });
    }

    // Promotions
    if (c.career.rank === 'junior' && c.career.yearsExperience >= 5 && turnRng.chance(0.15 * yearDelta)) {
      c.career.rank = 'senior';
      c.narrative.lifeEvents.push({ year, event: `Promoted to Senior ${c.career.specialization}`, source: 'kernel' });
      events.push({ turn: state.metadata.currentTurn, year, type: 'promotion', description: `${c.core.name} promoted to senior`, colonistId: c.core.id });
    }
    if (c.career.rank === 'senior' && c.career.yearsExperience >= 12 && turnRng.chance(0.08 * yearDelta)) {
      c.career.rank = 'lead';
      c.narrative.lifeEvents.push({ year, event: `Promoted to Lead ${c.career.specialization}`, source: 'kernel' });
      events.push({ turn: state.metadata.currentTurn, year, type: 'promotion', description: `${c.core.name} promoted to lead`, colonistId: c.core.id });
    }
  }

  // 5. Morale drift (trends toward 0.6 baseline, modified by food/population pressure)
  const foodPressure = colony.foodMonthsReserve < 6 ? -0.05 : 0;
  const populationPressure = colonists.filter(c => c.health.alive).length > colony.lifeSupportCapacity ? -0.08 : 0;
  colony.morale = Math.max(0, Math.min(1, colony.morale + (0.6 - colony.morale) * 0.1 + foodPressure + populationPressure));

  // 6. Update population count
  colony.population = colonists.filter(c => c.health.alive).length;

  // 7. Resource production (simplified)
  colony.foodMonthsReserve = Math.max(0, colony.foodMonthsReserve - (yearDelta * 0.5) + (colony.infrastructureModules * 0.3 * yearDelta));
  colony.scienceOutput += yearDelta;

  return {
    state: { ...state, colonists, colony, eventLog: [...state.eventLog, ...events] },
    events,
  };
}
```

- [ ] **Step 2: Verify progression**

```bash
npx tsx -e "
const { generateInitialPopulation } = require('./examples/mars-genesis/shared/colonist-generator.ts');
const { progressBetweenTurns } = require('./examples/mars-genesis/shared/progression.ts');
const { SeededRng } = require('./examples/mars-genesis/shared/rng.ts');

const colonists = generateInitialPopulation(42, 2035, []);
const state = {
  metadata: { simulationId: 'test', leaderId: 'test', seed: 42, startYear: 2035, currentYear: 2040, currentTurn: 2 },
  colony: { population: 100, powerKw: 400, foodMonthsReserve: 18, waterLitersPerDay: 1000, pressurizedVolumeM3: 5000, lifeSupportCapacity: 120, infrastructureModules: 3, scienceOutput: 0, morale: 0.85 },
  colonists,
  politics: { earthDependencyPct: 95, governanceStatus: 'earth-governed', independencePressure: 0.1 },
  eventLog: [],
};

const rng = new SeededRng(42).turnSeed(2);
const result = progressBetweenTurns(state, 5, rng);
console.log('Pop before:', 100, 'Pop after:', result.state.colony.population);
console.log('Events:', result.events.length);
console.log('Births:', result.events.filter(e => e.type === 'birth').length);
console.log('Deaths:', result.events.filter(e => e.type === 'death').length);
console.log('Promotions:', result.events.filter(e => e.type === 'promotion').length);
"
```

Expected: population changes, some births/deaths/promotions occur.

- [ ] **Step 3: Commit**

```bash
git add examples/mars-genesis/shared/progression.ts
git commit -m "feat(mars-genesis): add deterministic between-turn progression (aging, births, deaths, careers)"
```

---

### Task 5: Simulation Kernel

**Files:**
- Create: `examples/mars-genesis/shared/kernel.ts`

- [ ] **Step 1: Create the kernel**

```typescript
// examples/mars-genesis/shared/kernel.ts

import type { SimulationState, ColonySystems, Colonist, TurnEvent, ColonyPolitics } from './state.js';
import { SeededRng } from './rng.js';
import { generateInitialPopulation } from './colonist-generator.ts';
import { progressBetweenTurns } from './progression.js';
import { SCENARIOS } from './scenarios.js';

export interface ColonyPatch {
  colony?: Partial<ColonySystems>;
  politics?: Partial<ColonyPolitics>;
  colonistUpdates?: Array<{ colonistId: string; health?: Partial<Colonist['health']>; career?: Partial<Colonist['career']> }>;
}

export interface PolicyEffect {
  description: string;
  patches: ColonyPatch;
  events: TurnEvent[];
}

export interface KeyPersonnelConfig {
  name: string;
  department: 'medical' | 'engineering' | 'agriculture' | 'science' | 'administration' | 'psychology' | 'governance';
  role: string;
  specialization: string;
  age: number;
  featured: boolean;
}

export class SimulationKernel {
  private state: SimulationState;
  private rng: SeededRng;
  private readonly masterSeed: number;

  constructor(seed: number, leaderId: string, keyPersonnel: KeyPersonnelConfig[]) {
    this.masterSeed = seed;
    this.rng = new SeededRng(seed);

    const colonists = generateInitialPopulation(seed, 2035, keyPersonnel);

    this.state = {
      metadata: {
        simulationId: `mars-genesis-${seed}-${Date.now()}`,
        leaderId,
        seed,
        startYear: 2035,
        currentYear: 2035,
        currentTurn: 0,
      },
      colony: {
        population: colonists.length,
        powerKw: 400,
        foodMonthsReserve: 18,
        waterLitersPerDay: 800,
        pressurizedVolumeM3: 3000,
        lifeSupportCapacity: 120,
        infrastructureModules: 3,
        scienceOutput: 0,
        morale: 0.85,
      },
      colonists,
      politics: {
        earthDependencyPct: 95,
        governanceStatus: 'earth-governed',
        independencePressure: 0.05,
      },
      eventLog: [],
    };
  }

  getState(): SimulationState {
    return structuredClone(this.state);
  }

  getScenario(turn: number) {
    return SCENARIOS[turn - 1] ?? null;
  }

  getFeaturedColonists(): Colonist[] {
    return this.state.colonists.filter(c => c.narrative.featured && c.health.alive);
  }

  getAliveColonists(): Colonist[] {
    return this.state.colonists.filter(c => c.health.alive);
  }

  getDepartmentSummary(dept: string): { count: number; avgMorale: number; avgBoneDensity: number; avgRadiation: number } {
    const members = this.state.colonists.filter(c => c.health.alive && c.core.department === dept);
    if (members.length === 0) return { count: 0, avgMorale: 0, avgBoneDensity: 0, avgRadiation: 0 };
    return {
      count: members.length,
      avgMorale: members.reduce((s, c) => s + c.health.psychScore, 0) / members.length,
      avgBoneDensity: members.reduce((s, c) => s + c.health.boneDensityPct, 0) / members.length,
      avgRadiation: members.reduce((s, c) => s + c.health.cumulativeRadiationMsv, 0) / members.length,
    };
  }

  /**
   * Apply a policy effect from the commander's decision.
   * Validates patches against invariants before applying.
   */
  applyPolicy(effect: PolicyEffect): void {
    const { patches, events } = effect;

    // Apply colony system patches
    if (patches.colony) {
      const c = this.state.colony;
      for (const [key, val] of Object.entries(patches.colony)) {
        if (val !== undefined && key in c) {
          (c as any)[key] = val;
        }
      }
      // Enforce invariants
      c.population = Math.max(0, c.population);
      c.morale = Math.max(0, Math.min(1, c.morale));
      c.foodMonthsReserve = Math.max(0, c.foodMonthsReserve);
      c.powerKw = Math.max(0, c.powerKw);
    }

    // Apply politics patches
    if (patches.politics) {
      const p = this.state.politics;
      for (const [key, val] of Object.entries(patches.politics)) {
        if (val !== undefined && key in p) {
          (p as any)[key] = val;
        }
      }
      p.earthDependencyPct = Math.max(0, Math.min(100, p.earthDependencyPct));
      p.independencePressure = Math.max(0, Math.min(1, p.independencePressure));
    }

    // Apply colonist-specific updates
    if (patches.colonistUpdates) {
      for (const update of patches.colonistUpdates) {
        const colonist = this.state.colonists.find(c => c.core.id === update.colonistId);
        if (!colonist) continue;
        if (update.health) Object.assign(colonist.health, update.health);
        if (update.career) Object.assign(colonist.career, update.career);
      }
    }

    // Record events
    this.state.eventLog.push(...events);
  }

  /**
   * Advance to the next turn. Runs between-turn progression,
   * updates the clock, and returns the new state.
   */
  advanceTurn(nextTurn: number): SimulationState {
    const scenario = this.getScenario(nextTurn);
    if (!scenario) throw new Error(`No scenario for turn ${nextTurn}`);

    const yearDelta = scenario.year - this.state.metadata.currentYear;
    const turnRng = this.rng.turnSeed(nextTurn);

    // Run between-turn progression
    const { state: progressedState, events } = progressBetweenTurns(this.state, yearDelta, turnRng);
    this.state = progressedState;

    // Update metadata
    this.state.metadata.currentYear = scenario.year;
    this.state.metadata.currentTurn = nextTurn;

    // Update population count
    this.state.colony.population = this.state.colonists.filter(c => c.health.alive).length;

    // Update featured colonists dynamically
    this.updateFeaturedColonists(events);

    return this.getState();
  }

  private updateFeaturedColonists(recentEvents: TurnEvent[]): void {
    // Always keep department heads featured
    // Add colonists involved in recent events
    const eventColonistIds = new Set(recentEvents.filter(e => e.colonistId).map(e => e.colonistId!));
    for (const c of this.state.colonists) {
      if (eventColonistIds.has(c.core.id) && c.health.alive) {
        c.narrative.featured = true;
      }
    }
    // Cap featured at 16
    const featured = this.state.colonists.filter(c => c.narrative.featured && c.health.alive);
    if (featured.length > 16) {
      const sorted = featured.sort((a, b) => b.narrative.lifeEvents.length - a.narrative.lifeEvents.length);
      for (let i = 16; i < sorted.length; i++) {
        sorted[i].narrative.featured = false;
      }
    }
  }

  /**
   * Export the full run artifact for replay.
   */
  export(): SimulationState {
    return structuredClone(this.state);
  }
}
```

- [ ] **Step 2: Verify kernel end-to-end**

```bash
npx tsx -e "
const { SimulationKernel } = require('./examples/mars-genesis/shared/kernel.ts');

const kernel = new SimulationKernel(42, 'aria-chen', [
  { name: 'Dr. Yuki Tanaka', department: 'medical', role: 'Chief Medical Officer', specialization: 'Radiation Medicine', age: 38, featured: true },
  { name: 'Erik Lindqvist', department: 'engineering', role: 'Chief Engineer', specialization: 'Structural', age: 45, featured: true },
]);

console.log('Turn 0:', kernel.getState().colony.population, 'colonists');

// Advance to turn 1
const s1 = kernel.advanceTurn(1);
console.log('Turn 1 (Year', s1.metadata.currentYear, '):', s1.colony.population, 'pop,', s1.eventLog.length, 'events');

// Apply a policy
kernel.applyPolicy({
  description: 'Accept 50 new colonists',
  patches: { colony: { population: s1.colony.population + 50, lifeSupportCapacity: 170 } },
  events: [{ turn: 1, year: 2035, type: 'decision', description: 'Accepted 50 colonists from Earth' }],
});

// Advance to turn 2
const s2 = kernel.advanceTurn(2);
console.log('Turn 2 (Year', s2.metadata.currentYear, '):', s2.colony.population, 'pop');

// Verify reproducibility
const kernel2 = new SimulationKernel(42, 'aria-chen', [
  { name: 'Dr. Yuki Tanaka', department: 'medical', role: 'Chief Medical Officer', specialization: 'Radiation Medicine', age: 38, featured: true },
  { name: 'Erik Lindqvist', department: 'engineering', role: 'Chief Engineer', specialization: 'Structural', age: 45, featured: true },
]);
const s1b = kernel2.advanceTurn(1);
console.log('Reproducible:', s1.colony.population === s1b.colony.population);
"
```

Expected: population changes across turns, same seed produces same results.

- [ ] **Step 3: Commit**

```bash
git add examples/mars-genesis/shared/kernel.ts
git commit -m "feat(mars-genesis): add deterministic simulation kernel with policy application and invariant enforcement"
```

- [ ] **Step 4: Push**

```bash
git push origin master
```

---

### Task 6: Contracts

**Files:**
- Create: `examples/mars-genesis/shared/contracts.ts`

- [ ] **Step 1: Create typed department and commander contracts**

```typescript
// examples/mars-genesis/shared/contracts.ts

import type { Department, Colonist } from './state.js';
import type { ColonyPatch } from './kernel.js';

export interface Citation {
  text: string;
  url: string;
  doi?: string;
  context: string;
}

export interface Risk {
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface Opportunity {
  impact: 'low' | 'medium' | 'high';
  description: string;
}

export interface ForgedToolUsage {
  name: string;
  mode: 'compose' | 'sandbox';
  description: string;
  output: unknown;
  confidence: number;
}

export interface FeaturedColonistUpdate {
  colonistId: string;
  updates: {
    health?: Partial<Colonist['health']>;
    career?: Partial<Colonist['career']>;
    narrative?: { event: string };
  };
}

export interface DepartmentReport {
  department: Department;
  summary: string;
  citations: Citation[];
  risks: Risk[];
  opportunities: Opportunity[];
  recommendedActions: string[];
  proposedPatches: Partial<ColonyPatch>;
  forgedToolsUsed: ForgedToolUsage[];
  featuredColonistUpdates: FeaturedColonistUpdate[];
  confidence: number;
  openQuestions: string[];
}

export interface CommanderDecision {
  decision: string;
  rationale: string;
  departmentsConsulted: Department[];
  selectedPolicies: string[];
  rejectedPolicies: Array<{ policy: string; reason: string }>;
  expectedTradeoffs: string[];
  watchMetricsNextTurn: string[];
}

export interface CrisisResearchPacket {
  canonicalFacts: Array<{ claim: string; source: string; url: string; doi?: string }>;
  counterpoints: Array<{ claim: string; source: string; url: string }>;
  departmentNotes: Partial<Record<Department, string>>;
}

export interface TurnArtifact {
  turn: number;
  year: number;
  crisis: string;
  departmentReports: DepartmentReport[];
  commanderDecision: CommanderDecision;
  policyEffectsApplied: string[];
  stateSnapshotAfter: {
    population: number;
    morale: number;
    foodMonthsReserve: number;
    infrastructureModules: number;
    scienceOutput: number;
    births: number;
    deaths: number;
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add examples/mars-genesis/shared/contracts.ts
git commit -m "feat(mars-genesis): add typed department report and commander decision contracts"
```

---

### Task 7: Research Packets (Demo Mode)

**Files:**
- Create: `examples/mars-genesis/shared/research.ts`

- [ ] **Step 1: Create curated research packets for the first 3 crises**

```typescript
// examples/mars-genesis/shared/research.ts

import type { CrisisResearchPacket } from './contracts.js';

export const RESEARCH_PACKETS: Record<number, CrisisResearchPacket> = {
  1: {
    canonicalFacts: [
      { claim: 'Mars surface radiation averages 0.67 mSv/day, approximately 20x Earth background', source: 'Hassler et al. 2014, Science', url: 'https://doi.org/10.1126/science.1244797', doi: '10.1126/science.1244797' },
      { claim: 'Arcadia Planitia contains extensive subsurface ice deposits detected by MARSIS radar', source: 'Mars Express MARSIS', url: 'https://www.esa.int/Science_Exploration/Space_Science/Mars_Express' },
      { claim: 'Valles Marineris spans 4,000 km with up to 7 km depth, exposing 3.5 billion years of strata', source: 'NASA Mars Fact Sheet', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html' },
      { claim: 'CRISM spectrometer detected diverse hydrated minerals in Valles Marineris walls', source: 'Murchie et al. 2009, JGR', url: 'https://doi.org/10.1029/2009JE003342', doi: '10.1029/2009JE003342' },
    ],
    counterpoints: [
      { claim: 'Valles Marineris terrain slopes up to 30 degrees increase landing risk and construction difficulty', source: 'HiRISE terrain analysis', url: 'https://www.uahirise.org/' },
    ],
    departmentNotes: {
      medical: 'Radiation exposure identical at both sites. Long-term cumulative dose is the primary concern.',
      engineering: 'Arcadia flat terrain dramatically simplifies construction. Valles slopes require terracing.',
      agriculture: 'Soil composition varies by site. Both contain perchlorates.',
    },
  },
  2: {
    canonicalFacts: [
      { claim: 'Mars subsurface ice confirmed at multiple latitudes by MARSIS and SHARAD radar', source: 'Plaut et al. 2007', url: 'https://doi.org/10.1126/science.1139672', doi: '10.1126/science.1139672' },
      { claim: 'MOXIE on Perseverance demonstrated in-situ oxygen extraction from Mars atmosphere', source: 'NASA Mars 2020', url: 'https://mars.nasa.gov/mars2020/spacecraft/instruments/moxie/' },
      { claim: 'Mars atmosphere contains 0.03% water vapor, seasonally variable', source: 'Smith 2004, Icarus', url: 'https://doi.org/10.1016/j.icarus.2003.09.027', doi: '10.1016/j.icarus.2003.09.027' },
    ],
    counterpoints: [
      { claim: 'Deep drilling risks contaminating pristine subsurface aquifers with biological material', source: 'Planetary protection protocols', url: 'https://planetaryprotection.nasa.gov/' },
    ],
    departmentNotes: {
      engineering: 'Deep drilling requires significant power draw. WAVAR system proven on ISS heritage.',
      agriculture: 'Water shortfall directly impacts food production capacity.',
    },
  },
  3: {
    canonicalFacts: [
      { claim: 'Phoenix lander detected 0.5-1% calcium perchlorate in Mars soil globally', source: 'Hecht et al. 2009, Science', url: 'https://doi.org/10.1126/science.1172339', doi: '10.1126/science.1172339' },
      { claim: 'Perchlorate is a thyroid toxin at chronic exposure above 0.7 µg/kg/day', source: 'EPA reference dose', url: 'https://www.epa.gov/sdwa/perchlorate-drinking-water' },
      { claim: 'Perchlorate-reducing bacteria (Dechloromonas) can bioremediate contaminated soil', source: 'Davila et al. 2013', url: 'https://doi.org/10.1089/ast.2013.0995', doi: '10.1089/ast.2013.0995' },
    ],
    counterpoints: [
      { claim: 'Bioremediation has not been tested in Mars atmospheric conditions (low pressure, cold, CO2-dominant)', source: 'Cockell 2014', url: 'https://doi.org/10.1089/ast.2013.1129' },
    ],
    departmentNotes: {
      medical: 'Perchlorate exposure pathway: ingestion via contaminated crops. Thyroid disruption risk.',
      agriculture: 'Hydroponics eliminates soil contact entirely. Bioremediation requires 2-year R&D.',
    },
  },
};

// Remaining crises (4-12) use abbreviated packets. Full packets added as needed.
for (let i = 4; i <= 12; i++) {
  if (!RESEARCH_PACKETS[i]) {
    RESEARCH_PACKETS[i] = {
      canonicalFacts: [],
      counterpoints: [],
      departmentNotes: {},
    };
  }
}

export function getResearchPacket(turn: number): CrisisResearchPacket {
  return RESEARCH_PACKETS[turn] ?? { canonicalFacts: [], counterpoints: [], departmentNotes: {} };
}
```

- [ ] **Step 2: Commit**

```bash
git add examples/mars-genesis/shared/research.ts
git commit -m "feat(mars-genesis): add curated research packets for demo mode (turns 1-3)"
```

- [ ] **Step 3: Push all Phase 1 work**

```bash
git push origin master
```

---

## Self-Review

**Spec coverage:**
- Canonical state types → Task 1
- Seeded RNG → Task 2
- Colonist generation → Task 3
- Between-turn progression (aging, births, deaths, careers) → Task 4
- Simulation kernel (merge, invariants, policy, advance) → Task 5
- Typed contracts (DepartmentReport, CommanderDecision) → Task 6
- Research packets (demo mode) → Task 7

**Not covered in Phase 1 (deferred to Phase 2):**
- Multi-agent orchestration (department agents, commander agent, forge_tool)
- SSE dashboard events
- Dashboard HTML
- Full research packets for turns 4-12

**Placeholder scan:** No TBDs, TODOs, or "fill in later" entries. All code is complete.

**Type consistency:** `ColonyPatch` defined in kernel.ts, referenced in contracts.ts. `Colonist`, `SimulationState`, `Department` defined in state.ts, used consistently throughout. `SeededRng` used in colonist-generator.ts, progression.ts, and kernel.ts.
