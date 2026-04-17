---
title: "Paracosm — AI Simulation Engine"
sidebar_position: 1
---

Paracosm is an AI agent swarm simulation engine built on AgentOS. Define a scenario as JSON, run it with AI commanders that have different [HEXACO](/features/hexaco-personality) personality profiles, and watch their decisions diverge into measurably different outcomes from the same seed. The reference scenario ships as Mars Genesis: a thirty-colonist Mars colony running from 2035 to 2067 across six turns.

**[Live demo](https://paracosm.agentos.sh/sim)** · **[GitHub](https://github.com/framersai/paracosm)** · **[npm](https://www.npmjs.com/package/paracosm)** · **[API reference](/paracosm)** · **[Case study blog post](https://agentos.sh/blog/inside-mars-genesis-ai-colony-simulation)**

## Quick Start

```bash
npm install paracosm
```

```typescript
import { marsScenario } from 'paracosm/mars';
import { runSimulation } from 'paracosm/runtime';

const aria = {
  name: 'Aria Chen',
  archetype: 'The Visionary',
  colony: 'Colony Alpha',
  hexaco: {
    openness: 0.95, conscientiousness: 0.35, extraversion: 0.85,
    agreeableness: 0.55, emotionality: 0.30, honestyHumility: 0.65,
  },
  instructions: '',
};

const result = await runSimulation(aria, [], {
  scenario: marsScenario,
  maxTurns: 6,
  seed: 950,
  onEvent: e => console.log(e.type, e.data?.title),
});

console.log(result.finalState.colony.population);
console.log(result.totalToolsForged);
```

Or run the hosted demo at [paracosm.agentos.sh/sim](https://paracosm.agentos.sh/sim) with zero setup. The demo caps turns, population, and model tier so public access stays affordable; paste your own OpenAI or Anthropic key into Settings to unlock full scope.

## What it does

Paracosm runs two leaders through the same scenario in parallel and makes their divergence measurable. Each turn has nine stages:

| Stage | Kind | Responsibility |
|-------|------|----------------|
| Event Director | LLM | Observes state, generates events |
| Kernel advance | det. | Aging, births, deaths, resource deltas |
| Department analysis | LLM | Each dept may forge or reuse a tool |
| Commander decision | LLM | Reads all reports, picks an option |
| Outcome | det. | Seeded RNG + option risk probability |
| Effects | det. | Colony deltas via the EffectRegistry |
| Agent reactions | LLM | Every alive agent reacts in parallel |
| Memory | det. | Short-term consolidates, stances drift |
| Personality drift | det. | HEXACO traits shift under three forces |

Two runs on the same seed produce identical deterministic stages. The LLM stages diverge because every prompt carries the leader's HEXACO profile and the accumulated state it shaped. The asymmetry is the entire point.

## How HEXACO drives decisions

Paracosm uses the [HEXACO model](/features/hexaco-personality) (Ashton & Lee, 2007) across all six axes, with both poles producing concrete behavioral cues in the commander's decision-style block and the department analysis prompts:

- **Openness** — high: favor novel, untested approaches; low: trust proven protocols.
- **Conscientiousness** — high: demand evidence and contingency plans; low: move fast, accept ambiguity.
- **Extraversion** — high: lead from the front with public comms; low: work through technical channels.
- **Agreeableness** — high: seek consensus with departments and Earth; low: override consensus when you see a better path.
- **Emotionality** — high: weigh human cost heavily; low: accept casualties for strategic gain.
- **Honesty-Humility** — high: report failures transparently; low: leverage information asymmetries.

Trait thresholds are 0.7 (high) and 0.3 (low); cues only fire when a trait is meaningfully expressed. Visible in action at [departments.ts:90](https://github.com/framersai/paracosm/blob/master/src/runtime/departments.ts#L90) and [commander-setup.ts:30](https://github.com/framersai/paracosm/blob/master/src/runtime/commander-setup.ts#L30).

## Emergent tool forging + reuse

Department agents forge computational tools at runtime using AgentOS's [`EmergentCapabilityEngine`](/features/emergent-capabilities). The `forge_tool` meta-tool builds, tests, and judge-reviews a new tool; the `call_forged_tool` meta-tool lets a later turn invoke that already-approved tool on new inputs without re-forging.

Personality drives the ratio. High-Openness leaders bias exploratory and forge more novel tools. High-Conscientiousness leaders bias conservative and reuse whenever an existing tool fits. On the same seed, the Visionary ends a six-turn run with a wider toolbox; the Engineer ends with a narrower toolbox but higher reuse count. The blog post walks through this as a case study: [Inside Mars Genesis](https://agentos.sh/blog/inside-mars-genesis-ai-colony-simulation).

Cost follows. Reuse via `call_forged_tool` costs essentially nothing; every fresh forge costs a judge LLM call plus sandbox execution. The reuse economy is the single biggest lever on total run cost.

## Scenario authoring

Any domain works. Mars colonies, submarine habitats, space stations, medieval kingdoms. The engine is domain-agnostic; the scenario JSON defines what gets simulated.

```json
{
  "id": "mars-genesis",
  "labels": { "name": "Mars Genesis", "populationNoun": "colonists", "settlementNoun": "colony" },
  "setup": { "defaultTurns": 6, "defaultSeed": 950, "defaultStartYear": 2035 },
  "departments": [
    { "id": "medical", "label": "Medical", "role": "Chief Medical Officer", "instructions": "..." },
    { "id": "engineering", "label": "Engineering", "role": "Chief Engineer", "instructions": "..." }
  ],
  "metrics": [
    { "id": "population", "format": "number" },
    { "id": "morale", "format": "percent" }
  ]
}
```

`compileScenario()` turns JSON into a runnable `ScenarioPackage` by generating TypeScript hook functions via LLM calls. Compilation costs about $0.10 per scenario and caches to disk. See [`compileScenario`](/paracosm/functions/compileScenario) for the full hook contract.

## Cost safety

The hosted demo uses three layered guards so public access stays affordable:

1. **Demo caps** when `PARACOSM_HOSTED_DEMO=true`: 6 turns (configurable), 30 colonists, 3 active departments, cheapest model tier. Settings UI locks the capped inputs and unlocks the moment a user pastes their own API key.
2. **Per-IP rate limit**: one simulation per IP per day for demo-mode requests, JSON-persisted across restarts.
3. **Abort gates**: when all SSE clients disconnect for longer than 1.5 seconds, an AbortController fires and the runtime checks it before every LLM call in the turn. At most one in-flight call completes after a tab closes.

Users who want more runs paste their own OpenAI or Anthropic key. The dashboard's cost modal breaks down per-stage spend (director, commander, dept-by-name, judge, reactions) so the reuse economy's impact on total cost is visible.

## API surface

```typescript
import type { ScenarioPackage, Agent } from 'paracosm';
import { marsScenario } from 'paracosm/mars';
import { lunarScenario } from 'paracosm/lunar';
import { runSimulation, runBatch } from 'paracosm/runtime';
import { SimulationKernel, SeededRng } from 'paracosm';
```

Full type reference is auto-generated from source at [/paracosm](/paracosm). The core types:

- [`ScenarioPackage`](/paracosm/interfaces/ScenarioPackage) — domain-agnostic scenario bundle
- [`LeaderConfig`](/paracosm/interfaces/LeaderConfig) — commander identity + HEXACO profile
- [`HexacoProfile`](/paracosm/interfaces/HexacoProfile) — six-axis personality vector
- [`SimulationKernel`](/paracosm/classes/SimulationKernel) — deterministic state machine
- [`runSimulation`](/paracosm/functions/runSimulation) — single-leader turn loop
- [`runBatch`](/paracosm/functions/runBatch) — parallel multi-scenario runner

## HTTP + SSE server

The dashboard server exposes a small HTTP API for driving sims from any client:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/setup` | Start a new simulation with leaders, turns, seed |
| `GET` | `/events` | SSE stream of simulation events |
| `POST` | `/clear` | Clear simulation state and chat agent pool |
| `POST` | `/chat` | Chat with a colonist agent |
| `GET` | `/results` | Full simulation results including verdict |
| `GET` | `/rate-limit` | Check rate limit status |
| `POST` | `/compile` | Compile a custom scenario from JSON |
| `GET` | `/admin-config` | Hosted-demo flags + effective caps |

`/events` replays a buffered event history on reconnect (persisted to disk so restarts do not evaporate completed runs), closes with a `replay_done` marker so clients can distinguish historical from live events.

## Related

- [Emergent Capabilities](/features/emergent-capabilities) — the forge + judge machinery underlying `forge_tool`
- [HEXACO Personality](/features/hexaco-personality) — trait model, mutation system, persona overlays
- [Cognitive Memory Guide](/features/cognitive-memory-guide) — the memory pipeline colonists use as chat agents
- [Inside Mars Genesis (blog)](https://agentos.sh/blog/inside-mars-genesis-ai-colony-simulation) — full case study
- [Emergent Tools and HEXACO Leaders (blog)](https://agentos.sh/blog/emergent-tools-hexaco-leaders) — two-leader-one-seed comparison
- [Build an AI Civilization in 5 Minutes (blog)](https://agentos.sh/blog/build-ai-civilization-simulation-paracosm) — tutorial
