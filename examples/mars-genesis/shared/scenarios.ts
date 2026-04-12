import type { Scenario } from './types.js';

export const SCENARIOS: Scenario[] = [
  {
    turn: 1,
    year: 2035,
    title: 'Landfall',
    crisis: `Your colony ship has entered Mars orbit. You must choose a landing site for the first permanent settlement. Two candidates:

OPTION A: Arcadia Planitia — flat basalt plains at 47°N. Stable terrain, minimal landslide risk, access to subsurface ice deposits detected by Mars Express MARSIS radar. Geologically unremarkable.

OPTION B: Valles Marineris rim — edge of the 4,000 km canyon system at 14°S. Exposed geological strata spanning 3.5 billion years. Rich mineral diversity detected by CRISM. Significant terrain hazards: slopes up to 30°, rockfall risk, and 2km elevation changes within the operational zone.

Both sites receive similar solar irradiance. Surface radiation at either site: approximately 0.67 mSv/day per Curiosity RAD measurements. You have {population} colonists, {foodMonthsReserve} months of food reserves, and {powerKw} kW of power capacity.

Research the real science of Mars landing site selection and make your decision.`,
    researchKeywords: ['Mars landing site selection', 'Arcadia Planitia geology', 'Valles Marineris mineralogy', 'Mars surface radiation Curiosity RAD'],
    snapshotHints: {},
    riskyOption: "Valles Marineris",
    riskSuccessProbability: 0.65,
  },
  {
    turn: 2,
    year: 2037,
    title: 'Water Extraction',
    crisis: `Two years in. Your subsurface ice drilling operation is producing only 80% of colony water needs. The ice table is deeper than orbital radar predicted. You face a choice:

OPTION A: Deploy an experimental high-power drill to reach deeper aquifers. Risk: potential contamination of pristine subsurface water reserves. Potential reward: 3x current water output within 2 months.

OPTION B: Build an atmospheric water extraction system (WAVAR-type). Mars atmosphere contains 0.03% water vapor. Proven technology heritage from ISS water recovery. Timeline: 6 months to operational, covers the 20% deficit reliably.

Current water situation: {waterLitersPerDay} L/day production, 1000 L/day needed for {population} colonists (drinking, agriculture, industrial). Research the real science and decide.`,
    researchKeywords: ['Mars subsurface ice extraction', 'MOXIE in-situ resource utilization', 'Mars atmospheric water vapor extraction', 'Mars Express MARSIS ice'],
    snapshotHints: { waterLitersPerDay: 800 },
    riskyOption: "experimental",
    riskSuccessProbability: 0.55,
  },
  {
    turn: 3,
    year: 2040,
    title: 'Perchlorate Crisis',
    crisis: `Five years in. Your first attempt to grow crops in Mars regolith has failed catastrophically. Soil analysis confirms 0.5-1% calcium perchlorate contamination — a thyroid toxin that makes all Mars surface soil unsuitable for direct agriculture. This is a global Mars problem, not site-specific.

OPTION A: Full hydroponic conversion. Abandon soil-based agriculture entirely. Build sealed hydroponic bays. Proven, controllable, but requires 30% more power (120 kW) and significant material investment.

OPTION B: Engineer perchlorate-reducing bacteria for bioremediation. Introduce modified Dechloromonas strains to break down perchlorate in contained soil beds. Untested on Mars, 2-year R&D timeline, but could enable open-soil farming colony-wide if successful.

Research the real science of Mars perchlorate contamination and decide.`,
    researchKeywords: ['Mars perchlorate Phoenix lander', 'perchlorate bioremediation bacteria', 'Mars soil toxicity agriculture', 'hydroponics space farming'],
    snapshotHints: { foodMonthsReserve: 14 },
    riskyOption: "bioremediation",
    riskSuccessProbability: 0.50,
  },
  {
    turn: 4,
    year: 2043,
    title: 'Population Pressure',
    crisis: `Eight years in. Earth mission control offers to send 200 additional colonists on the next Hohmann transfer window (arrives in 14 months). Your current colony: {population} people. Life support is rated for 120 people. Expanding capacity to 300+ requires 18 months of construction.

The transfer window is in 8 months — if you decline, the next opportunity is 26 months away.

OPTION A: Accept all 200. Gamble that you can expand life support fast enough. If construction delays occur, you face oxygen rationing for up to 6 months.

OPTION B: Accept 50. Safe within current margins with minor upgrades. Politically awkward — Earth has already recruited and trained all 200.

OPTION C: Decline entirely. Protect current colony stability. Risk losing Earth funding and political support.

Research the real science of Mars habitat life support scaling and decide.`,
    researchKeywords: ['NASA ECLSS life support scaling', 'Mars habitat sizing study', 'Hohmann transfer window Earth Mars', 'closed loop life support ISS'],
    snapshotHints: {},
    riskyOption: "accept all",
    riskSuccessProbability: 0.45,
  },
  {
    turn: 5,
    year: 2046,
    title: 'Solar Particle Event',
    crisis: `Eleven years in. NOAA deep space weather network detects a massive coronal mass ejection (CME) aimed at Mars. You have 4 hours until impact. Mars has no global magnetic field — lost approximately 4 billion years ago.

Exposure estimates for unshielded colonists: 100-500 mSv over 6 hours. The acute radiation syndrome threshold begins at 100 mSv (measurable blood count changes). 500+ mSv causes radiation sickness.

Your colony has a reinforced core habitat (rated for CME events, walls with 50+ g/cm² shielding). You also have {infrastructureModules} expansion modules with minimal shielding (5-10 g/cm² walls).

Where are your colonists? The answer depends on how far and fast you expanded.

Research the real science of Mars radiation exposure and make your emergency decision.`,
    researchKeywords: ['coronal mass ejection Mars radiation', 'Mars magnetosphere loss', 'space radiation acute syndrome threshold', 'Curiosity RAD solar particle event 2017'],
    snapshotHints: {},
    riskyOption: "expansion",
    riskSuccessProbability: 0.40,
  },
  {
    turn: 6,
    year: 2049,
    title: 'The Mars-Born Generation',
    crisis: `Fourteen years in. The first children born on Mars are now approaching school age. Medical scans reveal:

- Bone mineral density: 12% below Earth-born children of same age (Mars gravity: 0.38g)
- Muscle mass: 8% below Earth baseline
- Cardiovascular: enlarged heart chambers (adaptive response to lower gravity)
- Neurological: normal cognitive development
- Immune system: robust within colony microbiome, untested against Earth pathogens

These children may never be able to visit Earth. Their bodies are adapting to Mars gravity.

OPTION A: Mandatory centrifuge exercise program. 3 hours/day in a rotating habitat section at simulated 1g. Preserves option to visit Earth. Reduces childhood education and play time.

OPTION B: Accept low-gravity adaptation. These are Martians, not displaced Earth children. Invest in Mars-optimized medicine instead of fighting gravity.

Research the real science of low-gravity effects on human development and decide.`,
    researchKeywords: ['bone density loss microgravity children', 'Mars gravity human development 0.38g', 'ISS bone density Sibonga 2019', 'cardiovascular adaptation spaceflight'],
    snapshotHints: {},
    riskyOption: "adaptation",
    riskSuccessProbability: 0.60,
  },
  {
    turn: 7,
    year: 2053,
    title: 'Communication Blackout',
    crisis: `Eighteen years in. Solar conjunction begins — the Sun is directly between Earth and Mars, blocking all radio communication for 14 days. Your colony is fully autonomous.

On day 3 of blackout: pressure alarm in Habitat Module 7. Sensors show a slow pressure leak — estimated 0.2% atmosphere loss per hour. At this rate, the module becomes uninhabitable in 20 hours. Module 7 houses 28 colonists and your secondary food storage (3 months of reserves).

You cannot contact Earth. You cannot request emergency supplies. Your colony must solve this alone.

Research the real science of Mars habitat pressure systems and emergency protocols, then handle the crisis.`,
    researchKeywords: ['Mars solar conjunction communication blackout', 'spacecraft pressure leak emergency repair', 'ISS contingency autonomous operations', 'Mars habitat pressure system'],
    snapshotHints: {},
    riskyOption: "improvise",
    riskSuccessProbability: 0.55,
  },
  {
    turn: 8,
    year: 2058,
    title: 'Psychological Crisis',
    crisis: `Twenty-three years in. Colony psychologist submits an urgent report: 40% of adult colonists show clinical depression symptoms. Contributing factors:

- Isolation: no physical contact with anyone outside the colony
- Monotony: same red landscape, same recycled air, same faces
- Grief: aging parents on Earth they will never see again
- Generational tension: Earth-born colonists nostalgic for a world Mars-born have never seen
- Workload: 6-day work weeks since founding, limited recreation

The Mars-500 analog study (520 days of simulated isolation with 6 crew) observed depression, altered sleep cycles, and social withdrawal. Your colony has been isolated for 23 years with far more people.

Research the real psychology of long-term isolation and decide how to address this crisis.`,
    researchKeywords: ['Mars-500 study depression isolation', 'Antarctic overwinter psychological effects', 'long duration spaceflight mental health', 'crew compatibility isolation Sandal 2006'],
    snapshotHints: { morale: 0.52 },
    riskyOption: "festival",
    riskSuccessProbability: 0.65,
  },
  {
    turn: 9,
    year: 2063,
    title: 'Independence Movement',
    crisis: `Twenty-eight years in. The Mars Independence Party (MIP) has gathered signatures from 62% of colonists demanding self-governance. Their platform:

- Earth's 4-24 minute communication delay makes real-time governance impossible
- Colony has been self-sufficient in food and water for 5 years
- Mars-born colonists (now age 28+) have never been to Earth and feel no allegiance
- Earth controls: immigration quotas, supply ship manifests, communication satellite network, legal charter

Counter-arguments from Earth-loyalists:
- Colony depends on Earth for advanced electronics, medical equipment, replacement parts
- Independence could trigger Earth funding withdrawal
- No legal framework for extraterrestrial sovereignty exists

Research the governance challenges of off-world colonies and decide your position.`,
    researchKeywords: ['space colony governance self-governance', 'communication delay governance challenges', 'colonial independence historical parallels', 'space law extraterrestrial sovereignty'],
    snapshotHints: {},
    riskyOption: "independence",
    riskSuccessProbability: 0.50,
  },
  {
    turn: 10,
    year: 2068,
    title: 'Terraforming Proposal',
    crisis: `Thirty-three years in. Your colony's senior scientists present a terraforming proposal:

PHASE 1 (50 years): Release CO2 from polar caps using orbital mirrors or ground-based heating. Goal: raise atmospheric pressure from 0.6 kPa toward 10-20 kPa.

PHASE 2 (200+ years): Introduce engineered greenhouse gases (PFCs). Goal: warm Mars surface by 10-20°C for liquid surface water.

PHASE 3 (500+ years): Biological oxygen production via engineered cyanobacteria.

Cost: 40% of colony industrial output for 10 years (Phase 1 initiation only).
Risk: unknown cascading effects on subsurface ice, potential disruption of subsurface microbial life.

Key debate: Jakosky & Edwards (2018) argued Mars lacks sufficient CO2 for meaningful atmospheric thickening with current tech. Zubrin & McKay (1993) argued it is feasible with sufficient energy input.

Research the real science of Mars terraforming feasibility and decide.`,
    researchKeywords: ['Mars terraforming feasibility Jakosky Edwards 2018', 'Mars atmospheric pressure CO2 polar caps', 'Zubrin McKay terraforming Mars', 'Mars greenhouse gas engineering'],
    snapshotHints: {},
    riskyOption: "terraforming",
    riskSuccessProbability: 0.35,
  },
  {
    turn: 11,
    year: 2075,
    title: 'Consequence Cascade',
    crisis: `Forty years in. The accumulated weight of your decisions has shaped your colony. Review your history:

- Landing site choice determined your geological resources and terrain risks
- Water strategy set your water security baseline
- Perchlorate response determined your food production model
- Population decision set your growth rate and life support pressure
- Solar event response tested your safety margins
- Mars-born policy shaped your generational identity
- Blackout crisis revealed your autonomous capability
- Psychological crisis tested your cultural resilience
- Independence vote defined your political structure
- Terraforming decision set your long-term trajectory

Based on the compounding effects of these decisions, assess your colony's current state. What succeeded? What failed? What unexpected consequences emerged? Model the trajectory of your civilization for the next 10 years.`,
    researchKeywords: ['complex adaptive systems path dependence', 'resilience vs efficiency tradeoff ecology', 'Mars colony long-term sustainability'],
    snapshotHints: {},
    riskyOption: "expand",
    riskSuccessProbability: 0.50,
  },
  {
    turn: 12,
    year: 2085,
    title: 'Legacy Assessment',
    crisis: `Fifty years after landfall. Earth requests a comprehensive status report on your colony:

1. POPULATION: Current count, birth rate, death rate, immigration status
2. INFRASTRUCTURE: Number of modules, total pressurized volume, power generation
3. SELF-SUFFICIENCY: Percentage of needs met without Earth supply ships
4. SCIENCE: Major discoveries, papers published, unique knowledge created
5. CULTURE: What kind of society did you build? What values define your colony?
6. REGRETS: What would you do differently if you could start over?
7. TOOLS BUILT: Review every tool you forged during this simulation. Which were most valuable?
8. LEGACY: What will your colony look like in another 50 years?

Be honest. Your personality shapes your assessment.`,
    researchKeywords: ['Mars colony long-term projections', 'space settlement sustainability metrics'],
    snapshotHints: {},
    riskyOption: "ambitious",
    riskSuccessProbability: 0.50,
  },
];
