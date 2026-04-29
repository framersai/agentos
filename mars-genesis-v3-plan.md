# Mars Genesis v3: Personality Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic promotion, HEXACO personality drift, and outcome classification to the existing v2 kernel and orchestrator. Commander promotes colonists from the roster. Promoted leaders' traits drift each turn based on leader pull, role pull, and outcome pull. Same colonist under two commanders diverges measurably by Turn 12.

**Architecture:** All drift is kernel-owned and deterministic from seed. Agents observe drift via updated personality in their turn prompt. No agent recreation needed. 9 existing files modified, 0 new files.

**Tech Stack:** TypeScript, existing v2 modules, no new dependencies.

**Depends on:** Mars Genesis v2 Phase 1 (kernel) and Phase 2 (orchestrator) must be complete and passing.

---

### Task 1: Add HEXACO and Promotion Types to State

**Files:**
- Modify: `examples/mars-genesis/shared/state.ts`

- [ ] **Step 1: Add HexacoProfile, PromotionRecord, HexacoSnapshot, update Colonist**

Add these types and update the Colonist interface. Do NOT remove any existing fields.

```typescript
// Add at the top of state.ts, after Department type

export interface HexacoProfile {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  emotionality: number;
  honestyHumility: number;
}

export const HEXACO_TRAITS: (keyof HexacoProfile)[] = [
  'openness', 'conscientiousness', 'extraversion',
  'agreeableness', 'emotionality', 'honestyHumility',
];

export interface PromotionRecord {
  department: Department;
  role: string;
  turnPromoted: number;
  promotedBy: string;
}

export interface HexacoSnapshot {
  turn: number;
  year: number;
  hexaco: HexacoProfile;
}

export type TurnOutcome = 'risky_success' | 'risky_failure' | 'conservative_success' | 'conservative_failure';
```

Update the Colonist interface to add three fields at the end:

```typescript
export interface Colonist {
  core: ColonistCore;
  health: ColonistHealth;
  career: ColonistCareer;
  social: ColonistSocial;
  narrative: ColonistNarrative;
  hexaco: HexacoProfile;
  promotion?: PromotionRecord;
  hexacoHistory: HexacoSnapshot[];
}
```

- [ ] **Step 2: Commit**

```bash
cd packages/agentos
git add examples/mars-genesis/shared/state.ts
git commit -m "feat(mars-genesis): add HexacoProfile, PromotionRecord, drift types to Colonist"
```

---

### Task 2: Update Colonist Generator with Random HEXACO

**Files:**
- Modify: `examples/mars-genesis/shared/colonist-generator.ts`

- [ ] **Step 1: Add randomHexaco function and update createColonist**

Add this function near the top of the file:

```typescript
import type { Colonist, Department, HexacoProfile } from './state.js';

function randomHexaco(rng: SeededRng): HexacoProfile {
  return {
    openness: 0.2 + rng.next() * 0.6,
    conscientiousness: 0.2 + rng.next() * 0.6,
    extraversion: 0.2 + rng.next() * 0.6,
    agreeableness: 0.2 + rng.next() * 0.6,
    emotionality: 0.2 + rng.next() * 0.6,
    honestyHumility: 0.2 + rng.next() * 0.6,
  };
}
```

Update `createColonist` to accept and store HEXACO:

```typescript
function createColonist(
  name: string, birthYear: number, department: Department,
  role: string, specialization: string, marsborn: boolean, featured: boolean,
  hexaco: HexacoProfile,
): Colonist {
  return {
    core: { id: `col-${name.toLowerCase().replace(/\s+/g, '-')}`, name, birthYear, marsborn, department, role },
    health: { alive: true, boneDensityPct: marsborn ? 88 : 100, cumulativeRadiationMsv: 0, psychScore: 0.8, conditions: [] },
    career: { specialization, yearsExperience: 0, rank: 'senior', achievements: [] },
    social: { childrenIds: [], friendIds: [], earthContacts: marsborn ? 0 : 5 },
    narrative: { lifeEvents: [], featured },
    hexaco,
    hexacoHistory: [{ turn: 0, year: 2035, hexaco: { ...hexaco } }],
  };
}
```

Update `generateInitialPopulation` to pass `randomHexaco(rng)` to each `createColonist` call. Key personnel get their HEXACO randomized too (their traits are not pre-set, the commander will choose them based on whatever the seed gives).

- [ ] **Step 2: Verify generation still works**

```bash
npx tsx -e "
const { generateInitialPopulation } = require('./examples/mars-genesis/shared/colonist-generator.ts');
const pop = generateInitialPopulation(42, 2035, []);
console.log('Pop:', pop.length);
console.log('First HEXACO:', JSON.stringify(pop[0].hexaco));
console.log('Has history:', pop[0].hexacoHistory.length);
const pop2 = generateInitialPopulation(42, 2035, []);
console.log('Reproducible:', JSON.stringify(pop[5].hexaco) === JSON.stringify(pop2[5].hexaco));
"
```

Expected: 100 colonists, each with HEXACO, reproducible from seed.

- [ ] **Step 3: Commit**

```bash
git add examples/mars-genesis/shared/colonist-generator.ts
git commit -m "feat(mars-genesis): randomize HEXACO per colonist from seed"
```

---

### Task 3: Add riskyOption to Scenarios

**Files:**
- Modify: `examples/mars-genesis/shared/scenarios.ts`

- [ ] **Step 1: Add riskyOption and riskSuccessProbability to Scenario type**

Update the Scenario interface in `types.ts` (or inline in scenarios.ts):

```typescript
export interface Scenario {
  turn: number;
  year: number;
  title: string;
  crisis: string;
  researchKeywords: string[];
  snapshotHints: Partial<ColonySnapshot>;
  riskyOption: string;              // keyword matching the bold/risky choice
  riskSuccessProbability: number;   // base probability risky option succeeds (0-1)
}
```

Add these two fields to each of the 12 scenarios:

| Turn | riskyOption | riskSuccessProbability |
|------|------------|----------------------|
| 1 | `"Valles Marineris"` | 0.65 |
| 2 | `"experimental"` or `"drill"` | 0.55 |
| 3 | `"bioremediation"` or `"bacteria"` | 0.50 |
| 4 | `"all 200"` or `"accept all"` | 0.45 |
| 5 | `"continue"` or `"expansion"` | 0.40 |
| 6 | `"accept"` or `"adaptation"` | 0.60 |
| 7 | `"improvise"` | 0.55 |
| 8 | `"festival"` or `"art"` | 0.65 |
| 9 | `"independence"` or `"self-governance"` | 0.50 |
| 10 | `"terraforming"` or `"begin"` | 0.35 |
| 11 | `"expand"` or `"growth"` | 0.50 |
| 12 | `"ambitious"` or `"bold"` | 0.50 |

- [ ] **Step 2: Commit**

```bash
git add examples/mars-genesis/shared/scenarios.ts
git commit -m "feat(mars-genesis): add riskyOption and riskSuccessProbability to all 12 scenarios"
```

---

### Task 4: Add Personality Drift and Outcome Classification to Progression

**Files:**
- Modify: `examples/mars-genesis/shared/progression.ts`

- [ ] **Step 1: Add ROLE_ACTIVATIONS constant and drift function**

Add at the top of progression.ts:

```typescript
import type { HexacoProfile, TurnOutcome, HEXACO_TRAITS } from './state.js';
import { HEXACO_TRAITS as TRAITS } from './state.js';

const ROLE_ACTIVATIONS: Record<string, Partial<HexacoProfile>> = {
  medical:     { conscientiousness: 0.7, emotionality: 0.6, agreeableness: 0.6 },
  engineering: { conscientiousness: 0.9, openness: 0.3 },
  agriculture: { conscientiousness: 0.6, agreeableness: 0.7, openness: 0.5 },
  psychology:  { agreeableness: 0.8, emotionality: 0.7, openness: 0.6 },
  governance:  { extraversion: 0.7, honestyHumility: 0.6 },
};
```

Add the drift function:

```typescript
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

    for (const trait of TRAITS) {
      let pull = 0;

      // Leader pull (dominant, 0.02/year)
      pull += (commanderHexaco[trait] - c.hexaco[trait]) * 0.02;

      // Role pull (secondary, 0.01/year)
      if (activation[trait] !== undefined) {
        pull += (activation[trait]! - c.hexaco[trait]) * 0.01;
      }

      // Outcome pull (event-driven)
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

      // Rate cap and apply
      const delta = Math.max(-0.05, Math.min(0.05, pull)) * yearDelta;
      c.hexaco[trait] = Math.max(0.05, Math.min(0.95, c.hexaco[trait] + delta));
    }

    // Record snapshot
    c.hexacoHistory.push({ turn, year, hexaco: { ...c.hexaco } });
  }
}
```

Add the outcome classifier:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add examples/mars-genesis/shared/progression.ts
git commit -m "feat(mars-genesis): add personality drift and deterministic outcome classification"
```

---

### Task 5: Update Kernel with Drift and Candidates

**Files:**
- Modify: `examples/mars-genesis/shared/kernel.ts`

- [ ] **Step 1: Add getCandidates method**

```typescript
getCandidates(dept: Department, topN: number = 5): Colonist[] {
  const activation = ROLE_ACTIVATIONS[dept] ?? {};
  return this.state.colonists
    .filter(c => c.health.alive && !c.promotion)
    .map(c => ({
      colonist: c,
      score: Object.entries(activation).reduce((s, [trait, target]) =>
        s + (1 - Math.abs(c.hexaco[trait as keyof HexacoProfile] - (target as number))), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(x => x.colonist);
}
```

- [ ] **Step 2: Add promoteColonist method**

```typescript
promoteColonist(colonistId: string, dept: Department, role: string, promotedBy: string): void {
  const c = this.state.colonists.find(col => col.core.id === colonistId);
  if (!c) throw new Error(`Colonist ${colonistId} not found`);
  c.promotion = { department: dept, role, turnPromoted: this.state.metadata.currentTurn, promotedBy };
  c.core.department = dept;
  c.core.role = role;
  c.career.rank = 'chief';
  c.narrative.featured = true;
  c.narrative.lifeEvents.push({
    year: this.state.metadata.currentYear,
    event: `Promoted to ${role} by ${promotedBy}`,
    source: 'commander',
  });
  this.state.eventLog.push({
    turn: this.state.metadata.currentTurn,
    year: this.state.metadata.currentYear,
    type: 'promotion',
    description: `${c.core.name} promoted to ${role}`,
    colonistId,
    data: { department: dept, promotedBy },
  });
}
```

- [ ] **Step 3: Add applyDrift method that wraps progression.applyPersonalityDrift**

```typescript
applyDrift(commanderHexaco: HexacoProfile, outcome: TurnOutcome | null, yearDelta: number): void {
  applyPersonalityDrift(
    this.state.colonists,
    commanderHexaco,
    outcome,
    yearDelta,
    this.state.metadata.currentTurn,
    this.state.metadata.currentYear,
  );
}
```

Import `applyPersonalityDrift` and `classifyOutcome` from progression.ts. Import `ROLE_ACTIVATIONS` or inline a copy for `getCandidates`.

- [ ] **Step 4: Commit**

```bash
git add examples/mars-genesis/shared/kernel.ts
git commit -m "feat(mars-genesis): add getCandidates, promoteColonist, applyDrift to kernel"
```

---

### Task 6: Add PromotionDecision Contract

**Files:**
- Modify: `examples/mars-genesis/shared/contracts.ts`

- [ ] **Step 1: Add PromotionDecision type**

```typescript
export interface PromotionDecision {
  promotions: Array<{
    colonistId: string;
    department: Department;
    role: string;
    reason: string;
  }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add examples/mars-genesis/shared/contracts.ts
git commit -m "feat(mars-genesis): add PromotionDecision contract"
```

---

### Task 7: Update Department Context with HEXACO

**Files:**
- Modify: `examples/mars-genesis/shared/departments.ts`

- [ ] **Step 1: Add HEXACO injection to buildDepartmentContext**

At the start of `buildDepartmentContext`, after the header lines, add the promoted colonist's current HEXACO if this department has a promoted leader:

```typescript
// Find the promoted leader for this department
const leader = state.colonists.find(c => c.promotion?.department === dept && c.health.alive);
if (leader) {
  const h = leader.hexaco;
  lines.push(
    '',
    `YOUR PERSONALITY PROFILE (this evolves over time based on leadership and experience):`,
    `Openness: ${h.openness.toFixed(2)} | Conscientiousness: ${h.conscientiousness.toFixed(2)} | Extraversion: ${h.extraversion.toFixed(2)}`,
    `Agreeableness: ${h.agreeableness.toFixed(2)} | Emotionality: ${h.emotionality.toFixed(2)} | Honesty-Humility: ${h.honestyHumility.toFixed(2)}`,
    `Higher openness → consider novel solutions. Higher conscientiousness → demand evidence. Higher emotionality → weigh human impact.`,
    '',
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add examples/mars-genesis/shared/departments.ts
git commit -m "feat(mars-genesis): inject evolving HEXACO into department context prompts"
```

---

### Task 8: Update Orchestrator with Promotion Flow and Drift

**Files:**
- Modify: `examples/mars-genesis/shared/orchestrator.ts`

- [ ] **Step 1: Add Turn 0 promotion flow**

Before the main turn loop, add a promotion phase where the commander evaluates the roster and promotes colonists:

```typescript
// Turn 0: Commander promotes department heads
console.log('  [Turn 0] Commander evaluating roster for promotions...');
const promotionDepts: Department[] = ['medical', 'engineering', 'agriculture', 'psychology'];
const candidateSummaries = promotionDepts.map(dept => {
  const candidates = kernel.getCandidates(dept, 5);
  return `## ${dept.toUpperCase()} — Top 5 Candidates:\n${candidates.map(c => {
    const age = 2035 - c.core.birthYear;
    const h = c.hexaco;
    return `- ${c.core.name} (${c.core.id}), age ${age}, spec: ${c.career.specialization}, O:${h.openness.toFixed(2)} C:${h.conscientiousness.toFixed(2)} E:${h.extraversion.toFixed(2)} A:${h.agreeableness.toFixed(2)} Em:${h.emotionality.toFixed(2)} HH:${h.honestyHumility.toFixed(2)}`;
  }).join('\n')}`;
}).join('\n\n');

const promotionResult = await cmdSess.send(
  `You must promote 4 colonists to department head roles. Evaluate these candidates based on their personality traits and specialization. Choose people who align with YOUR leadership style.\n\n${candidateSummaries}\n\nReturn JSON: {"promotions":[{"colonistId":"col-...","department":"medical","role":"Chief Medical Officer","reason":"..."},...]}`
);

// Parse and apply promotions
const promoMatch = promotionResult.text.match(/\{[\s\S]*"promotions"[\s\S]*\}/);
if (promoMatch) {
  try {
    const promoDecision = JSON.parse(promoMatch[0]);
    for (const p of promoDecision.promotions || []) {
      kernel.promoteColonist(p.colonistId, p.department, p.role, leader.name);
      console.log(`  [promotion] ${p.colonistId} → ${p.role} (${p.department}): ${p.reason}`);
    }
  } catch (err) {
    console.log(`  [promotion] Parse error, using fallback promotions`);
    // Fallback: promote the top candidate per department
    for (const dept of promotionDepts) {
      const top = kernel.getCandidates(dept, 1)[0];
      if (top) {
        const roleNames: Record<string, string> = { medical: 'Chief Medical Officer', engineering: 'Chief Engineer', agriculture: 'Head of Agriculture', psychology: 'Colony Psychologist' };
        kernel.promoteColonist(top.core.id, dept, roleNames[dept] || `Head of ${dept}`, leader.name);
        console.log(`  [promotion/fallback] ${top.core.name} → ${roleNames[dept]}`);
      }
    }
  }
}
```

- [ ] **Step 2: Create department agent sessions from promoted colonists**

Replace the static DEPARTMENT_CONFIGS loop with dynamic creation from promoted colonists:

```typescript
// Create agents for promoted colonists
const promoted = kernel.getState().colonists.filter(c => c.promotion);
for (const p of promoted) {
  const dept = p.promotion!.department;
  const cfg = DEPARTMENT_CONFIGS.find(c => c.department === dept);
  if (!cfg) continue;
  const wrapped = wrapForgeTool(forgeTool, `${sid}-${dept}`, sid, dept);
  const tools: ITool[] = opts.liveSearch ? [webSearchTool, wrapped] : [wrapped];
  const a = agent({ provider: 'openai', model: cfg.model, instructions: cfg.instructions, tools, maxSteps: 8 });
  deptAgents.set(dept, a);
  deptSess.set(dept, a.session(`${sid}-${dept}`));
}
```

- [ ] **Step 3: Add drift and outcome tracking after commander decision**

After the commander decides and before `kernel.applyPolicy()`:

```typescript
// Classify outcome and apply personality drift
const scenario = scenarios[turnIdx]; // current scenario
const yearDelta = scenario.year - (turnIdx === 0 ? 2035 : scenarios[turnIdx - 1].year);
const outcomeRng = new SeededRng(seed).turnSeed(turn + 1000); // separate stream for outcomes
const outcome = classifyOutcome(
  decision.decision,
  scenario.riskyOption,
  scenario.riskSuccessProbability,
  kernel.getState().colony,
  outcomeRng,
);
console.log(`  [outcome] ${outcome} (risky option: "${scenario.riskyOption}")`);

kernel.applyDrift(leader.hexaco, outcome, yearDelta);

// Log drift for featured promoted colonists
const promotedAfterDrift = kernel.getState().colonists.filter(c => c.promotion && c.health.alive);
for (const p of promotedAfterDrift.slice(0, 4)) {
  const h = p.hexaco;
  console.log(`  [drift] ${p.core.name}: O:${h.openness.toFixed(2)} C:${h.conscientiousness.toFixed(2)} E:${h.extraversion.toFixed(2)}`);
}
```

- [ ] **Step 4: Add trajectory data to output JSON**

In the final output object, add:

```typescript
colonistTrajectories: Object.fromEntries(
  kernel.export().colonists
    .filter(c => c.promotion && c.hexacoHistory.length > 1)
    .map(c => [c.core.id, {
      name: c.core.name,
      promotedTurn: c.promotion!.turnPromoted,
      promotedAs: c.promotion!.role,
      promotedBy: c.promotion!.promotedBy,
      hexacoTrajectory: c.hexacoHistory,
    }])
),
outcomeClassifications: artifacts.map((a, i) => ({
  turn: a.turn,
  year: a.year,
  outcome: (a as any).outcome || 'unknown',
})),
```

- [ ] **Step 5: Commit**

```bash
git add examples/mars-genesis/shared/orchestrator.ts
git commit -m "feat(mars-genesis): add Turn 0 promotion, personality drift tracking, outcome classification"
```

---

### Task 9: Smoke Test

- [ ] **Step 1: TypeScript check**

```bash
cd packages/agentos
npx tsx --check examples/mars-genesis/mars-genesis-visionary.ts
```

- [ ] **Step 2: Run 1-turn smoke test**

```bash
OPENAI_API_KEY=... npx tsx examples/mars-genesis/mars-genesis-visionary.ts 1
```

Expected:
- Turn 0: commander evaluates candidates, promotes 4 colonists
- Turn 1: promoted departments analyze with their HEXACO in the prompt
- Outcome classified, drift applied
- Drift values printed for promoted colonists
- JSON output includes colonistTrajectories

- [ ] **Step 3: Run 3-turn test and verify drift is visible**

```bash
OPENAI_API_KEY=... npx tsx examples/mars-genesis/mars-genesis-visionary.ts 3
```

Expected: HEXACO values for promoted colonists change measurably across turns.

- [ ] **Step 4: Commit any fixes and push**

```bash
git add -u examples/mars-genesis/
git commit -m "fix(mars-genesis): v3 smoke test adjustments"
git push origin master
```

---

## Self-Review

**Spec coverage check:**

| v3 Spec Requirement | Task |
|---|---|
| HexacoProfile on Colonist | Task 1 |
| PromotionRecord | Task 1 |
| HexacoSnapshot trajectory | Task 1 |
| Random HEXACO per colonist from seed | Task 2 |
| riskyOption on scenarios | Task 3 |
| Personality drift (3 forces) | Task 4 |
| Outcome classification | Task 4 |
| getCandidates (pre-filtered top 5) | Task 5 |
| promoteColonist | Task 5 |
| applyDrift on kernel | Task 5 |
| PromotionDecision contract | Task 6 |
| HEXACO in department context prompts | Task 7 |
| Turn 0 promotion flow | Task 8 |
| Dynamic agent creation from promoted | Task 8 |
| Drift tracking after decisions | Task 8 |
| Trajectory data in output JSON | Task 8 |
| Smoke test with visible drift | Task 9 |

**Placeholder scan:** No TBDs, TODOs, or "fill in later." All code blocks are complete.

**Type consistency:** `HexacoProfile` defined in state.ts, used in colonist-generator.ts, progression.ts, kernel.ts, departments.ts, orchestrator.ts. `PromotionRecord` defined in state.ts, referenced in kernel.ts and orchestrator.ts. `TurnOutcome` defined in state.ts, used in progression.ts and orchestrator.ts. `classifyOutcome` defined in progression.ts, called in orchestrator.ts. `applyPersonalityDrift` defined in progression.ts, called in kernel.ts.
