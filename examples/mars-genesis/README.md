# Mars Genesis: Two Civilizations, Two Leaders

A 50-year Mars colonization simulation demonstrating AgentOS emergent tool forging,
HEXACO personality-driven decisions, and agent-researched scientific citations.

Two commanders face the same 12 crises across 50 years (2035-2085). Their HEXACO
personalities drive different decisions, different tool inventions, and different
civilizational outcomes.

## Commanders

**Aria Chen, "The Visionary"** (Openness: 0.95, Conscientiousness: 0.35)
Prioritizes discovery, expansion, and risk-taking. Forges growth and exploration tools.

**Dietrich Voss, "The Engineer"** (Conscientiousness: 0.97, Openness: 0.25)
Prioritizes safety, redundancy, and proven methods. Forges measurement and risk tools.

## Run

```bash
cd packages/agentos

# Run the Visionary simulation
ANTHROPIC_API_KEY=sk-ant-... SERPER_API_KEY=... npx tsx examples/mars-genesis/mars-genesis-visionary.ts

# Run the Engineer simulation
ANTHROPIC_API_KEY=sk-ant-... SERPER_API_KEY=... npx tsx examples/mars-genesis/mars-genesis-engineer.ts
```

Output is written to `examples/mars-genesis/output/`.

## The 12 Crises

| Turn | Year | Crisis | Real Science |
|------|------|--------|-------------|
| 1 | 2035 | Landfall: choose landing site | HiRISE terrain, Curiosity RAD radiation |
| 2 | 2037 | Water extraction failure | MARSIS ice radar, MOXIE ISRU |
| 3 | 2040 | Perchlorate poisoning | Phoenix lander soil chemistry |
| 4 | 2043 | Population pressure from Earth | NASA ECLSS life support scaling |
| 5 | 2046 | Solar particle event (CME) | Mars magnetosphere loss, radiation dosimetry |
| 6 | 2049 | Mars-born children: bone density | ISS bone loss studies, 0.38g extrapolation |
| 7 | 2053 | Communication blackout | Solar conjunction, autonomous operations |
| 8 | 2058 | Colony-wide depression | Mars-500 isolation study |
| 9 | 2063 | Independence movement | Space governance, communication delay |
| 10 | 2068 | Terraforming proposal | Jakosky & Edwards 2018 vs Zubrin & McKay 1993 |
| 11 | 2075 | Consequence cascade | Path dependence, compounding decisions |
| 12 | 2085 | Legacy assessment | 50-year civilization scorecard |

## What to Watch For

- Different decisions on the same crises driven by HEXACO personality
- Different tools forged reflecting each leader's priorities
- Real scientific citations found by the agent via web search
- Compounding consequences as early decisions cascade through later turns
- The tool registry at Turn 12 is a fingerprint of each leadership style

## Requirements

- Node.js 22+
- `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`)
- `SERPER_API_KEY` (for web search during research phases)
