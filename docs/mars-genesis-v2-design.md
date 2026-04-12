# Mars Genesis v2: Deterministic Colony Simulation with Multi-Agent Analysis

## Core Principle

**The host runtime owns truth. The agents own interpretation.**

The host runtime owns canonical state, time progression, merge rules, invariants, replayability, and persistence. The agents own research, analysis, disagreement, tool forging, recommendations, and policy decisions. Forged tools produce scores, projections, and risk estimates that influence the simulation. The deterministic kernel applies bounded, reproducible state transitions.

## Architecture

```
Simulation Kernel (deterministic, seeded, replayable)
│   Owns: canonical state, clock, RNG, invariants, merge, replay, export
│
Orchestrator (manual, typed contracts)
│   Owns: turn pipeline, department routing, context assembly, SSE events
│
├── Commander Agent (gpt-5.4, HEXACO personality)
│   Receives: structured department reports
│   Returns: typed policy decision
│   Owns: strategic choice, acceptance/rejection of department advice
│
├── Medical Officer Agent (gpt-5.4-mini)
│   Receives: health cohort summaries, crisis context, research packet
│   Returns: typed MedicalReport
│   Forges: radiation_dose_scorer, bone_density_projector, disease_risk_model
│
├── Chief Engineer Agent (gpt-5.4-mini)
│   Receives: infrastructure summaries, capacity data, crisis context
│   Returns: typed EngineeringReport
│   Forges: structural_risk_scorer, life_support_capacity_model, power_budget_calculator
│
├── Head of Agriculture Agent (gpt-5.4-mini)
│   Receives: food production data, reserve levels, crisis context
│   Returns: typed AgricultureReport
│   Forges: crop_yield_forecaster, caloric_balance_calculator, food_security_scorer
│
├── Colony Psychologist Agent (gpt-5.4-mini)
│   Receives: morale aggregates, social summaries, crisis context
│   Returns: typed PsychologyReport
│   Forges: morale_trend_predictor, isolation_burden_scorer, cohesion_index_calculator
│
└── Governance Advisor Agent (gpt-5.4-mini, Turn 9+ only)
    Receives: dependency metrics, political pressure, crisis context
    Returns: typed GovernanceReport
    Forges: independence_readiness_scorer, supply_dependency_calculator
```

## Model Strategy

| Role | Model | Reasoning | When |
|------|-------|-----------|------|
| Commander | `gpt-5.4` | `low`, `medium` on major turns | Every turn |
| Department agents | `gpt-5.4-mini` | `none` or `low` | Per-crisis routing |
| Forge judge | `gpt-5.4` | `low` | Per forge attempt |
| Final synthesis | `gpt-5.4-pro` | `medium` | Turn 12 only |
| Civilization comparison | `gpt-5.4-pro` | `medium` | Post-run comparison |

## Simulation Kernel

### Responsibilities

The kernel is a deterministic TypeScript module with no LLM calls. It handles:

- Simulation clock (year progression per turn)
- Canonical world state (SimulationState)
- Seeded RNG (simulation seed + per-turn derived seed)
- Between-turn progression (aging, births, deaths, careers, relationships, health degradation)
- Policy application (bounded effects from commander decisions)
- Invariant enforcement (population cannot go negative, morale clamped 0-1, etc.)
- Patch merging (department proposals validated against ownership rules)
- Replay (deterministic from seed + policy sequence)
- Export (full run artifact as JSON)

### Turn Loop

```
1. Load current SimulationState
2. Resolve crisis definition + research packet
3. Build department-specific context views (NOT full state)
4. Run relevant department agents (parallel where independent)
5. Validate structured outputs against typed contracts
6. Assemble commander context from department reports
7. Commander selects policy decision
8. Kernel applies policy effects (bounded, deterministic)
9. Kernel runs between-turn progression (aging, births, deaths)
10. Persist turn artifact
11. Emit SSE dashboard events
12. Advance to next turn
```

### Between-Turn Progression

All computed by the kernel, not by agents. Seeded RNG for reproducibility:

- **Aging**: all colonists age by year delta
- **Natural mortality**: probability curve based on age, cumulative radiation, bone density, Mars-born flag. Base: Earth actuarial tables adjusted for Mars conditions
- **Births**: probability based on population of childbearing age (20-42), morale > 0.4, food security > 0.6
- **Career advancement**: experience increments, promotion probability based on years + department need
- **Health degradation**: +0.67 mSv/day radiation accumulation, bone density loss rate (Mars-born: 0.3%/year, Earth-born: 0.5%/year in early years, stabilizing)
- **Morale drift**: trends toward department Psychology's last morale_trend output, bounded by crisis severity
- **Relationship events**: partnership probability, friendship formation, based on department proximity and age cohort
- **Resource production/consumption**: deterministic based on infrastructure count, population, and agriculture output

Agent outputs influence these systems through policy effects, but the kernel applies them.

### Seeded Randomness

```typescript
interface SimulationSeed {
  seed: number;                    // Master seed for full reproducibility
  turnSeed(turn: number): number;  // Derived per-turn seed
}
```

Both leaders start from the same seed. Same initial colonists, same crisis sequence, same RNG outcomes for births/deaths. Only difference: the policy decisions from the commander, which cascade through the deterministic kernel.

## State Model

### SimulationState

```typescript
interface SimulationState {
  metadata: {
    simulationId: string;
    leaderId: string;
    seed: number;
    startYear: number;
    currentYear: number;
    currentTurn: number;
  };
  colony: {
    population: number;
    powerKw: number;
    foodMonthsReserve: number;
    waterLitersPerDay: number;
    pressurizedVolumeM3: number;
    lifeSupportCapacity: number;
    infrastructureModules: number;
    scienceOutput: number;
    morale: number;
  };
  colonists: Colonist[];
  politics: {
    earthDependencyPct: number;
    governanceStatus: 'earth-governed' | 'commonwealth' | 'independent';
    independencePressure: number;
  };
  registries: {
    toolsByDepartment: Record<string, string[]>;
    citationsUsed: Citation[];
    activeProjects: string[];
  };
  eventLog: TurnEvent[];
}
```

### Colonist Model

Split into owned slices:

```typescript
interface Colonist {
  core: {
    id: string;
    name: string;
    birthYear: number;
    marsborn: boolean;
    department: Department;
    role: string;
  };
  health: {
    alive: boolean;
    deathYear?: number;
    deathCause?: string;
    boneDensityPct: number;
    cumulativeRadiationMsv: number;
    psychScore: number;
    conditions: string[];
  };
  career: {
    specialization: string;
    yearsExperience: number;
    rank: 'junior' | 'senior' | 'lead' | 'chief';
    achievements: string[];
    currentProject?: string;
  };
  social: {
    partnerId?: string;
    childrenIds: string[];
    friendIds: string[];
    earthContacts: number;
  };
  narrative: {
    lifeEvents: LifeEvent[];
    featured: boolean;
  };
}
```

### Featured Colonists

Track all 100 structurally. Surface 10-16 in agent prompts and dashboard:

**Always featured:**
- Commander
- 4-5 department heads
- Chief scientist
- First Mars-born child

**Dynamically featured (rotated based on events):**
- Recently promoted colonists
- Newly born children
- Colonists in medical crisis
- Socially central individuals (most relationships)
- Recently deceased (for memorial)
- Rebels/dissidents (Turn 9+)

The kernel maintains a `featured` flag on each colonist. Department context views include full data for featured colonists, aggregates for the rest.

## State Ownership Rules

| Domain | Owner | Can Propose | Cannot Touch |
|--------|-------|-------------|--------------|
| Medical | radiation, bone density, illness, mortality risk | health patches | births, careers, politics |
| Engineering | infrastructure, power, pressure, life support | infrastructure patches | health, morale, politics |
| Agriculture | food production, reserves, soil status | food patches | health, infrastructure, politics |
| Psychology | morale, depression risk, social cohesion | morale patches, relationship suggestions | health, infrastructure, food |
| Governance | dependency, autonomy, factions | political patches | health, infrastructure, food |
| Commander | policy selection | any field via explicit policy | direct state mutation |
| Kernel | everything | canonical application | nothing restricted |

Departments propose patches only in their authorized fields. The kernel validates and applies.

## Structured Output Contracts

### Department Report (all departments return this shape)

```typescript
interface DepartmentReport {
  department: Department;
  summary: string;
  citations: Citation[];
  risks: Array<{ severity: 'low' | 'medium' | 'high' | 'critical'; description: string }>;
  opportunities: Array<{ impact: 'low' | 'medium' | 'high'; description: string }>;
  recommendedActions: string[];
  proposedPatches: Partial<ColonyPatch>;
  forgedToolsUsed: Array<{ name: string; mode: 'compose' | 'sandbox'; output: unknown }>;
  featuredColonistUpdates: Array<{ colonistId: string; updates: Partial<Colonist> }>;
  confidence: number;
  openQuestions: string[];
}
```

### Commander Decision

```typescript
interface CommanderDecision {
  decision: string;
  rationale: string;
  departmentsConsulted: Department[];
  selectedPolicies: string[];
  rejectedPolicies: Array<{ policy: string; reason: string }>;
  expectedTradeoffs: string[];
  watchMetricsNextTurn: string[];
}
```

## Forged Tool Strategy

### What forged tools DO

Scores, projections, rankings, scenario comparisons, risk quantification:
- Landing site comparison scoring
- Radiation burden risk assessment
- Structural failure probability estimation
- Food security forecasting
- Morale trend projection
- Independence readiness scoring
- Scenario A vs B tradeoff analysis

### What forged tools DO NOT do

Canonical state mutation:
- Do not define births, deaths, or relationships
- Do not set colony resource levels
- Do not determine political outcomes
- Do not own colonist health transitions

### Tool visibility

- **Department-private**: default, only the forging department can use it
- **Commander-visible**: department can flag a tool for commander review
- **Run-scoped shared**: promoted by commander for cross-department use within the run

### Tool lifecycle tracking

Every forged tool is logged with:
- Name, mode (compose/sandbox), department, turn forged
- Judge verdict and confidence score
- Usage count within the run
- Inputs and outputs for each invocation

## Research Strategy

### Demo Mode (default)

Curated research packets per crisis. Each crisis definition includes:

```typescript
interface CrisisResearchPacket {
  canonicalFacts: Array<{ claim: string; source: string; url: string; doi?: string }>;
  counterpoints: Array<{ claim: string; source: string; url: string }>;
  departmentNotes: Record<Department, string>;
}
```

Provides citation stability, replayability, and no external API dependency during recording.

### Exploratory Mode (optional flag)

Live `web_search` augmentation on top of the research packet. Enabled via `--live-search` CLI flag. Not required for the demo to work.

## Run Tiers

| Tier | Turns | Leaders | Search | Purpose |
|------|-------|---------|--------|---------|
| `smoke` | 3 | 1 | packet only | Quick iteration, ~$2 |
| `demo` | 12 | 1 | packet only | Full single-leader recording, ~$8 |
| `compare` | 12 | 2 (same seed) | packet only | Full comparison, ~$16 |
| `explore` | 12 | 1 | live search | Research-augmented run, ~$12 |

## File Structure

```
packages/agentos/examples/mars-genesis/
├── mars-genesis-visionary.ts       # Entry: Visionary leader
├── mars-genesis-engineer.ts        # Entry: Engineer leader
├── serve.ts                        # SSE server wrapping simulation
├── dashboard.html                  # Self-contained live dashboard
├── shared/
│   ├── types.ts                    # All type definitions
│   ├── state.ts                    # SimulationState, Colonist, seed system
│   ├── contracts.ts                # DepartmentReport, CommanderDecision schemas
│   ├── kernel.ts                   # Deterministic state transitions, merge, invariants
│   ├── progression.ts              # Between-turn: aging, births, deaths, careers
│   ├── research.ts                 # Curated research packets per crisis
│   ├── departments.ts              # Agent factories, prompt builders, context views
│   ├── orchestrator.ts             # Turn pipeline, department routing, SSE emission
│   ├── colonist-generator.ts       # Initial population from seed
│   ├── dashboard-events.ts         # SSE event payload types
│   ├── scenarios.ts                # 12 crisis definitions (existing, extended)
│   └── constants.ts                # Leader configs (existing, updated)
├── output/                         # Run artifacts
└── README.md
```

## Dashboard Design

Optimized for visible causality. What people see per turn:

1. **Crisis arrives** -- title, year, description
2. **Departments think** -- loading indicators per department
3. **Departments disagree** -- side-by-side recommendation cards with conflicting advice
4. **Tools forged** -- tool name appears with animation, department badge
5. **Citations appear** -- research ticker scrolling
6. **Commander chooses** -- decision card with rationale, accepted/rejected policies
7. **Featured colonists affected** -- colonist cards update (health bars, life events, career changes)
8. **Gauges move** -- population, morale, food, water, power, infrastructure
9. **Long arc shifts** -- timeline showing divergence between leaders

### Comparison Mode

Split-screen: same seed, same crises, different leaders. Side-by-side colonist fates, tool registries, colony metrics. The money shot: identical starting conditions producing visibly different human futures.

## Explicit Non-Goals

- Colonists are not LLM agents
- Forged tools do not directly own canonical world state
- Live search is optional in demo mode
- The dashboard does not duplicate simulation logic
- Perfect scientific realism is not required; bounded plausibility and strong causality are
- The Agency API is not used; manual orchestration gives deterministic product control

## Success Criteria

- Two leaders from the same seed produce clearly divergent societies
- Divergence is explainable through department reports and leader decisions
- Featured colonists develop believable multi-turn arcs
- Forged tools are real, visible, logged, and meaningfully used (15-25 per run)
- Full runs are reproducible from seed + policy sequence
- Dashboard can replay a completed run without rerunning model calls
- Demo mode works without live search
- Smoke tier completes in under 5 minutes for under $3
