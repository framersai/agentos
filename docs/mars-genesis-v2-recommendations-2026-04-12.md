# Mars Genesis v2: Full Recommendations

Date: 2026-04-12

## Executive Summary

My recommendation is to rewrite Mars Genesis v2 around a **deterministic, research-grounded colony simulation kernel** with a **multi-agent interpretation and decision layer** on top.

The strongest version of this demo is **not**:

- "LLMs invent the whole simulation engine"
- "all state transitions are whatever forged tools say"
- "everything is live search and freeform narrative"

The strongest version of this demo **is**:

- a replayable colony simulator with a seeded world state
- real department agents with visible disagreements and distinct perspectives
- bounded emergent tool forging that genuinely matters
- research-backed crisis analysis with stable citations
- leader-specific choices that create visibly different societies over 50 years

That version will:

- look better in the video
- hold up better under Hacker News scrutiny
- be cheaper and more repeatable
- be easier to debug and improve
- still showcase AgentOS emergent behavior in a credible way

## The Core Thesis

Rewrite the spec around this principle:

- The **host runtime owns truth**
- The **agents own interpretation**

Concretely:

- The host runtime owns canonical state, time progression, merge rules, invariants, replayability, and persistence.
- The agents own research, analysis, disagreement, tool forging, recommendations, and policy decisions.

Forged tools should be **real and useful**, but they should not be the only authority on the simulation's canonical world state.

## What To Keep

Keep these parts of the current concept:

- One commander agent with a strong leader personality.
- Distinct department heads with different roles.
- 100 colonists as structured host-side data, not LLM agents.
- A 50-year timeline across 12 crises.
- Tool forging as a major visible behavior.
- Research-backed crisis handling.
- A final comparison between two leaders starting from the same initial conditions.
- A live dashboard as a separate surface consuming simulation events.

These are the right ingredients.

## What To Change

These are the changes I strongly recommend.

### 1. Do not make forged tools the simulation engine

The spec currently implies that aging, births, deaths, social changes, and other long-term state evolution are all computed by runtime-forged tools.

I do not recommend that.

Reasons:

- It is too brittle for a public-facing demo.
- It makes replayability weaker.
- It makes debugging much harder.
- It makes scientific plausibility less defensible.
- It creates too many failure modes inside the highest-risk part of the system.
- The current AgentOS emergent subsystem validates safety, test behavior, schema compliance, and determinism boundaries, but not true scientific correctness or long-horizon world coherence.

Recommended replacement:

- The simulation kernel applies all canonical state transitions.
- Forged tools provide scores, projections, rankings, model outputs, scenario comparisons, and risk estimates.
- The kernel consumes those outputs and applies bounded, deterministic updates.

The tools should influence the world, not define it outright.

### 2. Stop assuming every agent should run on GPT-5.4-pro

I verified this against current OpenAI docs on 2026-04-12.

OpenAI currently describes:

- `gpt-5.4` as the default for important general-purpose and multi-step agentic work
- `gpt-5.4-pro` as the option for harder problems needing deeper reasoning
- `gpt-5.4-mini` as the strong high-volume option for agent workflows

The pricing docs also show `gpt-5.4-pro` is dramatically more expensive than `gpt-5.4` and `gpt-5.4-mini`.

My recommendation:

- Commander: `gpt-5.4`
- Department agents: `gpt-5.4-mini`
- Forge judge: `gpt-5.4`
- Optional selective escalation to `gpt-5.4-pro` only for:
  - rare tie-break evaluations
  - final 50-year legacy synthesis
  - difficult disputed turns
  - maybe a final judge pass comparing the two civilizations

Suggested reasoning settings:

- Departments: `none` or `low`
- Commander: `low` by default, `medium` on major strategic turns
- Final synthesis: `medium`
- `pro` only on rare high-value moments

This is the right tradeoff for cost, speed, and reliability.

## The Architecture I Recommend

### Top-level structure

- One simulation runner
- One deterministic kernel
- One commander agent
- Four always-on department agents
- One governance agent that activates only in late-game turns
- One run artifact format
- One SSE event stream format
- One replayable dashboard

### Departments

Use these:

- Medical
- Engineering
- Agriculture
- Psychology
- Governance (Turn 9+ only)

Do not add more unless they clearly improve visible outcomes.

I would not add a separate Science agent in v2 unless you specifically want science output as a first-class driver. If you do, add it because it changes the story, not because it rounds out the org chart.

### Orchestration style

I still recommend **manual orchestration**.

Not because AgentOS lacks hierarchical delegation. It does have a hierarchical strategy.

I recommend manual orchestration because you need exact control over:

- which departments are invoked per turn
- what state slice each department receives
- what output contract each department must satisfy
- how patches merge
- when consequences apply
- what gets streamed to the dashboard
- how reruns and replays behave

So the design should say:

- use manual orchestration for deterministic integration and exact product control
- use typed department contracts
- use the host runtime as the state authority

### Shared engine

There should be one simulation-scoped engine for:

- tool registry
- event log
- seed / randomness
- state
- reusable research packet cache
- dashboard events

Each agent should have:

- stable agent ID
- stable session ID within a run
- explicit tool visibility rules

The spec should explicitly define whether tools are:

- private to a department
- visible to the commander
- promotable for reuse within the same run

## Simulation Kernel Design

This needs to be central in the rewrite.

### Kernel responsibilities

The host kernel should own:

- simulation clock
- canonical world state
- deterministic progression
- seeded RNG
- invariant enforcement
- patch merging
- replay
- export
- run summaries

### Turn loop

I recommend this exact conceptual flow:

1. Load current `SimulationState`
2. Resolve crisis definition and research packet
3. Build department-specific context views
4. Run relevant department agents
5. Validate their structured outputs
6. Hand department reports to commander
7. Commander selects policy / decision
8. Host kernel applies policy effects
9. Host kernel runs between-turn progression
10. Persist turn artifact
11. Emit SSE events
12. Continue to next turn

### Between-turn progression

This must be host-side and deterministic.

The kernel should handle:

- age progression
- natural mortality probabilities
- births
- career progression
- relationship state updates
- cumulative health degradation
- resource production and consumption
- morale drift
- political pressure drift

Agent outputs can influence these systems, but the kernel applies them.

### Seeded randomness

The spec should add a seed system:

- simulation seed
- per-turn derived seed
- deterministic random decisions for births, deaths, event selection, and tie-breaks

This lets you:

- reproduce runs
- compare leaders from the same initial conditions
- replay dashboard sessions exactly

## State Model Recommendation

### Canonical state

The rewrite should introduce a top-level `SimulationState` type.

Recommended structure:

- metadata
  - simulation id
  - leader id
  - seed
  - start year
  - current year
  - current turn
- colony systems
  - population
  - power
  - food
  - water
  - pressurized volume
  - life support capacity
  - reserves
  - infrastructure modules
  - science output
- colonists
  - full 100-colonist registry
- politics
  - Earth dependency
  - governance status
  - independence pressure
  - faction alignment
- registries
  - department tools
  - citations used
  - active projects
- event log
  - structured events for each turn

### Colonist model

I recommend splitting the colonist model into clearer owned slices.

- `ColonistCore`
  - id
  - name
  - birth year
  - age
  - Mars-born flag
  - department
  - role
- `ColonistHealth`
  - alive
  - death year
  - death cause
  - bone density
  - cumulative radiation
  - physical condition
  - psych score
  - active diagnoses
- `ColonistCareer`
  - specialization
  - years experience
  - rank
  - current project
  - achievements
- `ColonistSocial`
  - partner links
  - parent/child links
  - friend/colleague edges
  - Earth contacts
- `ColonistNarrative`
  - life events
  - featured flag
  - arc tags

### Featured colonists

This is important.

Track all 100 colonists structurally, but only surface 10-16 heavily in the UI and agent prompts.

Use a featured system:

- always include founding leaders and department heads
- elevate colonists who are:
  - recently promoted
  - newly born
  - newly dead
  - in crisis
  - socially central
  - historically significant

This keeps:

- the data rich
- the prompts tractable
- the dashboard emotionally legible

You do not need all 100 colonists to be equally narrativized for the demo to feel massive.

## State Ownership Rules

The current spec is ambiguous about who owns what. The rewrite must fix that.

### Host kernel owns

- canonical merge rules
- invariants
- RNG
- event emission
- replay
- system metrics
- final application of all patches

### Medical owns analysis of

- radiation burden
- bone density
- injuries
- acute illness
- chronic conditions
- mortality recommendations

### Engineering owns analysis of

- habitat risk
- power generation
- maintenance backlog
- pressure integrity
- life support capacity
- infrastructure failure scenarios

### Agriculture owns analysis of

- crop yield
- food production
- calorie sufficiency
- reserve depletion
- hydroponic throughput
- soil remediation feasibility

### Psychology owns analysis of

- morale
- isolation burden
- depression risk
- social cohesion
- relationship event likelihood

### Governance owns analysis of

- self-sufficiency
- autonomy pressure
- faction stability
- Earth dependency
- legitimacy and governance risk

### Commander owns

- final strategic choice
- acceptance or rejection of department advice
- policy package for the turn

## Prompt / Context Strategy

This part must change substantially.

### What not to do

Do not send the full colonist registry to every department every turn as raw JSON.

That will:

- bloat context
- raise cost
- reduce coherence
- create more variance
- make tool use less reliable

### What to do instead

Build **department-specific context views**.

Each department should receive:

- current crisis
- current year and turn
- recent system deltas
- department-owned aggregates
- relevant cohorts
- featured colonists relevant to the problem
- research packet for the crisis
- previous department tool outputs if still relevant

Examples:

- Medical gets radiation and health cohort summaries.
- Engineering gets infrastructure and capacity summaries.
- Agriculture gets production and reserve summaries.
- Psychology gets morale, generational, and social summaries.
- Governance gets autonomy and dependency summaries.

### Delta-based context

After early turns, departments should mostly receive:

- what changed since last turn
- essential global status
- relevant current cohorts

not the entire 50-year accumulated history every time.

### Commander context

Commander should get structured department outputs, not giant prose blobs.

Commander input should include:

- short department summaries
- top risks
- top opportunities
- disagreements
- citations
- recommended actions
- current colony scorecard

## Structured Output Contracts

This needs to be explicit in the rewrite.

Every department should return strict structured output.

Recommended department report shape:

- `department`
- `summary`
- `citations`
- `risks`
- `opportunities`
- `recommendedActions`
- `proposedPatches`
- `forgedToolsUsed`
- `confidence`
- `openQuestions`

Recommended commander output shape:

- `decision`
- `rationale`
- `departmentsConsulted`
- `selectedPolicies`
- `rejectedPolicies`
- `expectedTradeoffs`
- `watchMetricsNextTurn`

### Merge strategy

The rewrite should specify:

- departments may propose patches only in fields they are authorized to influence
- the commander chooses policy
- the host kernel validates and applies canonical updates
- impossible states are rejected or corrected by invariant rules

## Forged Tool Strategy

This is one of the most important visible parts of the demo, so it should stay strong, but bounded.

### What forged tools should do

Forged tools should be used for:

- landing site comparison
- radiation scoring
- structural risk scoring
- food security forecasting
- morale trend scoring
- independence readiness scoring
- scenario comparison
- risk/reward tradeoff quantification

### What forged tools should not do

They should not directly define:

- canonical births
- canonical deaths
- canonical relationship changes
- canonical colonist histories
- canonical politics transitions
- unrestricted long-horizon state mutation

### How to present tool forging

The rewrite should specify that forged tools are:

- logged
- typed
- department-scoped
- reusable within a run
- surfaced to the dashboard
- included in the run artifact

### Tool lifecycle

Define:

- private department tool
- commander-visible tool
- run-scoped shared tool

Do not rely on vague implicit reuse.

## Research Strategy

This needs a major rewrite.

### Demo mode

For the public demo, use curated research packets per crisis.

Each crisis should have:

- canonical links
- normalized facts
- optional counterpoints
- department-specific notes

This gives:

- citation stability
- replayability
- lower risk during recording
- less dependence on external search uptime

### Exploratory mode

Allow optional live search augmentation.

But it should not be required for the demo to work.

### Why this matters

Right now, depending on live search for every department and turn makes the demo vulnerable to:

- API outages
- variable search quality
- inconsistent citations
- cost spikes
- slower runs

That is not what you want for a flagship recorded demo.

## Model Strategy

This should be rewritten clearly and defensibly.

### Recommended allocation

- Commander: `gpt-5.4`
- Departments: `gpt-5.4-mini`
- Forge judge: `gpt-5.4`
- Optional high-stakes escalation: `gpt-5.4-pro`

### Why

- `gpt-5.4` is the current default model for important, multi-step agentic work.
- `gpt-5.4-mini` is suited to high-volume agent workflows.
- `gpt-5.4-pro` is best reserved for the hardest moments.

### Good escalation triggers

- final 50-year legacy synthesis
- close strategic disputes
- rare difficult judge reviews
- final comparison of the two civilizations

## Cost Strategy

Do not lock the spec to a speculative dollar range.

Instead define run tiers.

### Recommended tiers

- `smoke`
  - 3 turns
  - one leader
  - dossier-only research
- `demo`
  - 12 turns
  - one leader
  - replayable artifact
- `compare`
  - 12 turns
  - both leaders
  - same initial seed
  - comparison dashboard mode

### Measure, do not guess

The spec should say:

- cost is measured per run
- token and tool usage are recorded
- run tiers are designed to make iteration practical

## Implementation Shape

Rewrite the file structure section to something like this:

```text
packages/agentos/examples/mars-genesis/
├── mars-genesis-visionary.ts
├── mars-genesis-engineer.ts
├── serve.ts
├── dashboard.html
├── shared/
│   ├── state.ts
│   ├── contracts.ts
│   ├── kernel.ts
│   ├── progression.ts
│   ├── research.ts
│   ├── departments.ts
│   ├── orchestrator.ts
│   ├── dashboard-events.ts
│   ├── scenarios.ts
│   ├── constants.ts
│   └── types.ts
└── output/
```

### Module responsibilities

- `state.ts`
  - canonical state types
- `contracts.ts`
  - department report schemas and commander decision schema
- `kernel.ts`
  - deterministic application of policies and patches
- `progression.ts`
  - births, deaths, aging, careers, relationships
- `research.ts`
  - research dossier loading, citation normalization
- `departments.ts`
  - agent factories and prompt builders
- `orchestrator.ts`
  - full turn pipeline
- `dashboard-events.ts`
  - SSE event payload types

## Dashboard Recommendation

The dashboard should optimize for visible causality.

What people should see:

- crisis arrives
- departments think separately
- departments disagree
- forged tools appear in real time
- citations appear in real time
- commander chooses
- featured colonists are affected
- gauges move
- the long arc of the colony shifts

### Dashboard focus areas

- crisis panel
- department recommendation cards
- commander decision panel
- featured colonist grid
- event feed
- tool forge registry
- citation ticker
- colony gauges
- comparison view between leaders

### Comparison mode

This is highly recommended.

The strongest public-demo framing is:

- same starting seed
- same crisis sequence
- same colonist set
- different leader personalities
- different department emphasis
- different decisions
- different tools
- different 50-year outcomes

That is much more powerful than a single run in isolation.

## What Makes The Demo Actually Impressive

The impressive part is not the number of agents.

The impressive part is:

- identical starting conditions
- different reasoning styles
- different department priorities
- different tool ecosystems
- visibly different human futures
- clear long-term compounding consequences

That is what the rewrite should optimize for.

## Success Criteria I Recommend

Replace the current success criteria with these:

- Two leaders starting from the same seed produce clearly divergent societies.
- Divergence is explainable through department reports and leader decisions.
- Featured colonists develop believable long-term arcs.
- Forged tools are real, visible, logged, and meaningfully used.
- Full runs are reproducible from a saved seed and artifact.
- Dashboard can replay a completed run without rerunning model calls.
- Demo mode works without live search.
- The system is cheap enough to iterate repeatedly.

## Explicit Non-Goals

The rewrite should add these:

- Colonists are not LLM agents.
- Forged tools do not directly own canonical world state.
- Live search is optional in demo mode.
- The dashboard does not own or duplicate simulation logic.
- Perfect scientific realism is not required for v2; bounded plausibility and strong causality are.

## Specific Rewrite Directives For Claude

Tell Claude to make these exact changes:

- Replace "gpt-5.4-pro for all agents and judge" with a tiered model strategy.
- Replace "the tools ARE the simulation engine" with deterministic kernel + bounded analytical tooling.
- Keep manual orchestration, but justify it as deterministic product control.
- Add a seed / replay system.
- Add department-specific typed output contracts.
- Add explicit state ownership and merge rules.
- Add a featured-colonist concept.
- Add crisis research packets and a demo mode.
- Fix file paths to `packages/agentos/examples/mars-genesis/`.

## Final Recommendation

The right version of Mars Genesis v2 is:

- deterministic where truth matters
- agentic where interpretation matters
- research-grounded where credibility matters
- replayable where demos matter
- visually legible where storytelling matters

In one sentence:

- Build **a deterministic, replayable Mars colony simulator with multi-agent analysis, bounded emergent tool forging, curated crisis research, typed state contracts, and a video-first dashboard optimized around visible divergence and compounding consequence**.
