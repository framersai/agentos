# Mars Genesis v3: Emergent Society with Dynamic Leadership and Personality Evolution

## Core Change from v2

v2: static org chart. Department heads are pre-assigned. Their personalities are fixed.

v3: the commander starts alone with 100 undifferentiated colonists. Nobody has a role. The first crisis forces the commander to evaluate colonists and promote someone. Promoted leaders' HEXACO traits evolve over time based on the commander's leadership style, crisis outcomes, and role demands. By Turn 12, the same person under two different commanders is a fundamentally different leader.

## The Science

Personality trait change in adults is well-documented:

- **Role acquisition drives trait change.** Taking on leadership roles increases conscientiousness and emotional stability. [Hudson et al. 2020, Journal of Personality](https://www.ovid.com/00005203-202012000-00012) proposed that role demands shape trait expression over time.
- **Leader-follower alignment.** Followers' HEXACO traits drift toward their leader's profile over extended working relationships. [Van Iddekinge et al. 2023, European Journal of Work and Organizational Psychology](https://www.tandfonline.com/doi/full/10.1080/1359432X.2023.2250085) found personality fit predicts engagement.
- **Trait activation theory.** Work environments activate specific traits. A high-pressure engineering role activates conscientiousness. An exploration role activates openness. [Tett & Burnett 2003](https://doi.org/10.1037/0021-9010.88.3.500) formalized this as situational trait relevance.
- **Social investment principle.** Committing to social roles (career, family, community) drives trait maturation: increases in conscientiousness, agreeableness, and emotional stability. [Roberts et al. 2005](https://pmc.ncbi.nlm.nih.gov/articles/PMC3398702/).

## Personality Drift Model

### The Math

Each colonist's HEXACO profile is a 6-element vector. Drift is computed deterministically by the kernel each turn based on three forces:

```
trait_new = trait_old + (leader_pull + role_pull + outcome_pull) * drift_rate * year_delta
```

**1. Leader pull** (strongest force): promoted leaders' traits drift toward the commander's traits.

```
leader_pull[trait] = (commander[trait] - colonist[trait]) * 0.02
```

A Visionary commander (openness 0.95) pulls their medical officer's openness upward. An Engineer commander (conscientiousness 0.97) pulls their medical officer's conscientiousness upward. The rate is 0.02 per year, so over 50 years a promoted leader can shift by up to ~1.0 on any axis, but in practice the drift decelerates as they approach the commander's values (the gap shrinks).

**2. Role pull**: each department role has a trait profile it activates.

```typescript
const ROLE_TRAIT_ACTIVATIONS: Record<Department, Partial<HexacoProfile>> = {
  medical:      { conscientiousness: 0.7, emotionality: 0.6, agreeableness: 0.6 },
  engineering:  { conscientiousness: 0.9, openness: 0.3, emotionality: 0.4 },
  agriculture:  { conscientiousness: 0.6, agreeableness: 0.7, openness: 0.5 },
  psychology:   { agreeableness: 0.8, emotionality: 0.7, openness: 0.6 },
  governance:   { extraversion: 0.7, honestyHumility: 0.6, conscientiousness: 0.5 },
};

role_pull[trait] = (role_activation[trait] - colonist[trait]) * 0.01
```

Weaker than leader pull (0.01 vs 0.02). The role shapes them, but the leader shapes them more.

**3. Outcome pull**: crisis outcomes reinforce or punish traits.

- If a risky decision succeeds: the involved leader's openness gets a +0.03 bump
- If a risky decision fails: their openness gets a -0.05 bump, conscientiousness gets +0.03
- If a conservative decision succeeds: conscientiousness gets +0.02
- If a conservative decision fails (missed opportunity): openness gets +0.02

This creates a feedback loop: successful risk-taking breeds more risk-taking. Failed risks breed caution.

### Drift bounds

All traits clamped to [0.05, 0.95]. Nobody becomes a perfect 1.0 or 0.0. Rate caps at 0.05/year to prevent extreme swings.

### The Emergent Behavior

Under Commander Aria (Visionary, openness 0.95):
- Medical officer starts at openness 0.5, drifts to 0.7 by Turn 12
- She starts recommending experimental treatments, bioremediation, novel therapies
- Her forged tools shift from conservative risk scorers to speculative opportunity models

Under Commander Dietrich (Engineer, conscientiousness 0.97):
- Same medical officer starts at openness 0.5, drifts to 0.35 by Turn 12
- She becomes more protocol-driven, demands more data before acting
- Her forged tools shift from broad risk models to precise dosimetry calculators

Same person. Same initial traits. Completely different leader by Turn 12. The tool registries ARE the evidence of personality change.

## Dynamic Promotion System

### Turn 0: Commander Alone

The commander receives the colony roster (100 colonists with names, ages, specializations, and randomized HEXACO profiles). No roles are assigned.

### Turn 1: First Crisis Forces First Promotions

The commander evaluates the roster and promotes colonists to department head roles based on their specialization and personality fit. The commander's personality influences WHO they choose:

- A Visionary commander picks high-openness candidates: "I need people who think big"
- An Engineer commander picks high-conscientiousness candidates: "I need people who follow through"

The commander agent receives the full roster (featured colonists' full profiles, aggregates for the rest) and returns a `PromotionDecision`:

```typescript
interface PromotionDecision {
  promotions: Array<{
    colonistId: string;
    department: Department;
    role: string;
    reason: string;
  }>;
}
```

### Subsequent Turns: Promotions as Needed

The commander can promote additional colonists as new departments are needed (governance at Turn 9) or as existing leaders die, burn out, or get demoted.

### Dynamic Agent Creation

When a colonist is promoted, a new `agent()` is created with:
- The promoted colonist's current HEXACO profile as `personality`
- Department-specific instructions
- `forge_tool` access

As their personality drifts, their agent's personality config updates each turn. This means their LLM responses genuinely shift in tone and approach over time.

## Architecture Changes from v2

```
v2: Static agents created at startup
v3: Agents created dynamically when commander promotes colonists

v2: Commander -> pre-assigned dept heads
v3: Commander alone -> evaluates roster -> promotes -> dept heads emerge

v2: Fixed HEXACO per agent
v3: HEXACO drifts each turn (kernel computes, agent recreated with new values)

v2: Same person under both commanders behaves identically
v3: Same person diverges based on commander's pull
```

### Turn Flow (v3)

```
1. Kernel advances turn (aging, births, deaths, drift)
2. Kernel computes HEXACO drift for all promoted colonists
3. Orchestrator checks if commander needs to promote anyone
4. If yes: commander evaluates roster, makes PromotionDecision
5. New agents created for newly promoted colonists
6. Existing agents recreated with updated HEXACO values
7. Department agents analyze crisis (same as v2)
8. Commander synthesizes, decides
9. Kernel applies policy + records outcome for drift feedback
10. Next turn
```

### What the Kernel Adds

```typescript
// In progression.ts, new function:
function applyPersonalityDrift(
  colonists: Colonist[],
  commanderHexaco: HexacoProfile,
  turnOutcome: 'risky_success' | 'risky_failure' | 'conservative_success' | 'conservative_failure',
  yearDelta: number,
  rng: SeededRng,
): void {
  for (const c of colonists) {
    if (!c.health.alive || !c.promoted) continue;
    
    const dept = c.core.department;
    const roleActivation = ROLE_TRAIT_ACTIVATIONS[dept];
    
    for (const trait of HEXACO_TRAITS) {
      let pull = 0;
      
      // Leader pull (strongest)
      pull += (commanderHexaco[trait] - c.hexaco[trait]) * 0.02;
      
      // Role pull
      if (roleActivation[trait] !== undefined) {
        pull += (roleActivation[trait] - c.hexaco[trait]) * 0.01;
      }
      
      // Outcome pull
      if (trait === 'openness') {
        if (turnOutcome === 'risky_success') pull += 0.03;
        if (turnOutcome === 'risky_failure') pull -= 0.05;
        if (turnOutcome === 'conservative_failure') pull += 0.02;
      }
      if (trait === 'conscientiousness') {
        if (turnOutcome === 'risky_failure') pull += 0.03;
        if (turnOutcome === 'conservative_success') pull += 0.02;
      }
      
      // Apply with rate cap and bounds
      const delta = Math.max(-0.05, Math.min(0.05, pull)) * yearDelta;
      c.hexaco[trait] = Math.max(0.05, Math.min(0.95, c.hexaco[trait] + delta));
    }
  }
}
```

### Colonist Model Addition

```typescript
// Added to Colonist interface
interface Colonist {
  // ...existing fields...
  hexaco: HexacoProfile;           // Personal HEXACO (randomized at birth, drifts)
  promoted?: {
    department: Department;
    role: string;
    turnPromoted: number;
    promotedBy: string;             // Commander who promoted them
  };
  hexacoHistory: Array<{           // Track drift over time
    turn: number;
    year: number;
    hexaco: HexacoProfile;
    driftSource: string;            // "leader_pull", "role_pull", "outcome_pull"
  }>;
}
```

## Output Additions

The JSON artifact gains:
- Per-colonist HEXACO trajectory (history of trait values per turn)
- Promotion events with commander reasoning
- Drift source attribution per turn
- Side-by-side comparison: same colonist under two commanders

```json
{
  "colonistTrajectories": {
    "col-yuki-tanaka": {
      "name": "Dr. Yuki Tanaka",
      "promotedTurn": 1,
      "promotedAs": "Chief Medical Officer",
      "hexacoTrajectory": [
        { "turn": 1, "year": 2035, "openness": 0.52, "conscientiousness": 0.78 },
        { "turn": 6, "year": 2049, "openness": 0.61, "conscientiousness": 0.72 },
        { "turn": 12, "year": 2085, "openness": 0.71, "conscientiousness": 0.68 }
      ]
    }
  }
}
```

## Dashboard Impact

The trajectory data enables a killer visualization: a HEXACO radar chart per promoted colonist that ANIMATES over turns, visibly shifting toward the commander's profile. Side-by-side: same colonist, two commanders, two different personality trajectories.

## Success Criteria

- Commander autonomously evaluates roster and promotes colonists with personality-aligned reasoning
- Same colonist promoted under both commanders develops measurably different HEXACO profiles by Turn 12
- Personality drift is visible in the forged tool registries (Visionary's medical officer forges speculative tools, Engineer's forges precise tools)
- Trait trajectories are tracked and exportable for dashboard visualization
- Dynamic agent recreation works: agents' LLM behavior shifts as personality updates
- Promotion events are logged with commander reasoning

## Explicit Non-Goals for v3

- Colonists do not become LLM agents unless promoted
- Demotion is not implemented (future work)
- Personality drift for non-promoted colonists is not computed (too expensive)
- Commander's own personality does not drift (they are the fixed reference point)
- Children inherit a blend of parents' traits at birth but don't drift until promoted
