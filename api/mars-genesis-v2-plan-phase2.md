# Mars Genesis v2 Phase 2: Multi-Agent Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire 5 department agents and 1 commander agent on top of the Phase 1 deterministic kernel. Each department agent receives crisis-specific context views, forges domain tools via the EmergentCapabilityEngine, and returns typed DepartmentReports. The commander synthesizes reports into a CommanderDecision. The kernel applies the decision as a PolicyEffect.

**Architecture:** Manual orchestration loop: kernel advances turn, orchestrator builds per-department context views from kernel state, runs department agents in parallel, validates structured outputs, feeds reports to commander, commander decides, kernel applies policy. All agents use AgentOS `agent()` API with `web_search` and `forge_tool` ITools. Department agents use `gpt-5.4-mini`. Commander uses `gpt-5.4`. Judge uses `gpt-5.4`.

**Tech Stack:** TypeScript, `@framers/agentos` (`agent()`, `generateText()`, `EmergentCapabilityEngine`, `ForgeToolMetaTool`), Serper API for web search, Node.js 22+

**Depends on:** Phase 1 (kernel, state, contracts, research packets) must be complete.

---

### Task 1: Department Agent Factory

**Files:**
- Create: `examples/mars-genesis/shared/departments.ts`

- [ ] **Step 1: Create department agent factory and prompt builders**

```typescript
// examples/mars-genesis/shared/departments.ts

import type { ITool } from '@framers/agentos';
import type { Department, SimulationState, Colonist } from './state.js';
import type { DepartmentReport, CrisisResearchPacket } from './contracts.js';
import type { Scenario } from './types.js';

export interface DepartmentConfig {
  department: Department;
  role: string;
  model: string;
  instructions: string;
}

export const DEPARTMENT_CONFIGS: DepartmentConfig[] = [
  {
    department: 'medical',
    role: 'Chief Medical Officer',
    model: 'gpt-5.4-mini',
    instructions: `You are the Chief Medical Officer of a Mars colony. You analyze health impacts of crises: radiation exposure, bone density, disease, injuries, mortality risk, and psychological wellbeing.

You have access to web_search (for real scientific research) and forge_tool (to create computational models).

When you need to quantify health risks, radiation doses, disease spread, or mortality probabilities, use forge_tool to create a sandbox calculator. Your code MUST use: function execute(input) { return result; }

Return your analysis as JSON matching this exact schema:
{
  "department": "medical",
  "summary": "your analysis",
  "citations": [{"text": "...", "url": "...", "context": "..."}],
  "risks": [{"severity": "low|medium|high|critical", "description": "..."}],
  "opportunities": [{"impact": "low|medium|high", "description": "..."}],
  "recommendedActions": ["action1", "action2"],
  "proposedPatches": {"colonistUpdates": [{"colonistId": "...", "health": {...}}]},
  "forgedToolsUsed": [{"name": "...", "mode": "sandbox", "description": "...", "output": ..., "confidence": 0.9}],
  "featuredColonistUpdates": [{"colonistId": "...", "updates": {"health": {...}, "narrative": {"event": "..."}}}],
  "confidence": 0.85,
  "openQuestions": ["question1"]
}`,
  },
  {
    department: 'engineering',
    role: 'Chief Engineer',
    model: 'gpt-5.4-mini',
    instructions: `You are the Chief Engineer of a Mars colony. You analyze infrastructure risks: habitat integrity, power systems, life support capacity, water systems, and construction feasibility.

You have access to web_search and forge_tool. When you need to calculate structural loads, power budgets, life support margins, or pressure integrity, use forge_tool with sandbox mode. Your code MUST use: function execute(input) { return result; }

Return your analysis as JSON matching this exact schema:
{
  "department": "engineering",
  "summary": "your analysis",
  "citations": [{"text": "...", "url": "...", "context": "..."}],
  "risks": [{"severity": "low|medium|high|critical", "description": "..."}],
  "opportunities": [{"impact": "low|medium|high", "description": "..."}],
  "recommendedActions": ["action1", "action2"],
  "proposedPatches": {"colony": {"powerKw": ..., "infrastructureModules": ...}},
  "forgedToolsUsed": [],
  "featuredColonistUpdates": [],
  "confidence": 0.85,
  "openQuestions": []
}`,
  },
  {
    department: 'agriculture',
    role: 'Head of Agriculture',
    model: 'gpt-5.4-mini',
    instructions: `You are the Head of Agriculture for a Mars colony. You analyze food security: crop yields, soil remediation, hydroponic capacity, caloric needs, and reserve management.

You have access to web_search and forge_tool. When you need to calculate crop yields, caloric balance, or food security projections, use forge_tool with sandbox mode. Your code MUST use: function execute(input) { return result; }

Return your analysis as JSON matching the DepartmentReport schema with department: "agriculture".`,
  },
  {
    department: 'psychology',
    role: 'Colony Psychologist',
    model: 'gpt-5.4-mini',
    instructions: `You are the Colony Psychologist for a Mars colony. You analyze morale, isolation effects, depression risk, social cohesion, generational tensions, and community wellbeing.

You have access to web_search and forge_tool. When you need to model morale trends, isolation burden, or social network effects, use forge_tool with sandbox mode. Your code MUST use: function execute(input) { return result; }

Return your analysis as JSON matching the DepartmentReport schema with department: "psychology".`,
  },
  {
    department: 'governance',
    role: 'Governance Advisor',
    model: 'gpt-5.4-mini',
    instructions: `You are the Governance Advisor for a Mars colony. You analyze self-sufficiency, Earth dependency, political pressure, independence readiness, and governance structures.

You have access to web_search and forge_tool. When you need to score independence readiness or model supply chain dependency, use forge_tool with sandbox mode. Your code MUST use: function execute(input) { return result; }

Return your analysis as JSON matching the DepartmentReport schema with department: "governance".`,
  },
];

/**
 * Build a department-specific context view from the full simulation state.
 * Each department gets only the data relevant to its domain, not the full state.
 */
export function buildDepartmentContext(
  dept: Department,
  state: SimulationState,
  scenario: Scenario,
  researchPacket: CrisisResearchPacket,
): string {
  const alive = state.colonists.filter(c => c.health.alive);
  const featured = alive.filter(c => c.narrative.featured);
  const deptMembers = alive.filter(c => c.core.department === dept);
  const deptNote = researchPacket.departmentNotes[dept] || '';

  const header = [
    `TURN ${state.metadata.currentTurn} — YEAR ${state.metadata.currentYear}: ${scenario.title}`,
    '',
    scenario.crisis,
    '',
  ];

  const research = [
    'RESEARCH PACKET:',
    ...researchPacket.canonicalFacts.map(f => `- ${f.claim} [${f.source}](${f.url})`),
    ...(researchPacket.counterpoints.length ? ['COUNTERPOINTS:', ...researchPacket.counterpoints.map(c => `- ${c.claim} [${c.source}](${c.url})`)] : []),
    ...(deptNote ? [`DEPARTMENT NOTE: ${deptNote}`] : []),
    '',
  ];

  const colonyStatus = [
    'COLONY STATUS:',
    `Population: ${state.colony.population} | Morale: ${Math.round(state.colony.morale * 100)}%`,
    `Food: ${state.colony.foodMonthsReserve.toFixed(1)} months | Water: ${state.colony.waterLitersPerDay} L/day`,
    `Power: ${state.colony.powerKw} kW | Infrastructure: ${state.colony.infrastructureModules} modules`,
    `Life support capacity: ${state.colony.lifeSupportCapacity} | Science output: ${state.colony.scienceOutput}`,
    '',
  ];

  let domainData: string[];
  switch (dept) {
    case 'medical': {
      const avgRad = alive.reduce((s, c) => s + c.health.cumulativeRadiationMsv, 0) / alive.length;
      const avgBone = alive.reduce((s, c) => s + c.health.boneDensityPct, 0) / alive.length;
      const avgPsych = alive.reduce((s, c) => s + c.health.psychScore, 0) / alive.length;
      const conditions = alive.flatMap(c => c.health.conditions).filter(Boolean);
      domainData = [
        'HEALTH DATA:',
        `Average radiation: ${avgRad.toFixed(0)} mSv | Average bone density: ${avgBone.toFixed(1)}%`,
        `Average psych score: ${avgPsych.toFixed(2)} | Active conditions: ${conditions.length ? conditions.join(', ') : 'none'}`,
        `Mars-born: ${alive.filter(c => c.core.marsborn).length} | Earth-born: ${alive.filter(c => !c.core.marsborn).length}`,
        '',
        'FEATURED COLONIST HEALTH:',
        ...featured.slice(0, 8).map(c => `- ${c.core.name} (age ${state.metadata.currentYear - c.core.birthYear}): bone ${c.health.boneDensityPct.toFixed(0)}%, rad ${c.health.cumulativeRadiationMsv.toFixed(0)} mSv, psych ${c.health.psychScore.toFixed(2)}, conditions: ${c.health.conditions.join(', ') || 'none'}`),
      ];
      break;
    }
    case 'engineering':
      domainData = [
        'INFRASTRUCTURE DATA:',
        `Modules: ${state.colony.infrastructureModules} | Power: ${state.colony.powerKw} kW`,
        `Life support: ${state.colony.lifeSupportCapacity} capacity for ${state.colony.population} pop`,
        `Pressurized volume: ${state.colony.pressurizedVolumeM3} m³`,
        `Water production: ${state.colony.waterLitersPerDay} L/day`,
      ];
      break;
    case 'agriculture':
      domainData = [
        'FOOD DATA:',
        `Food reserves: ${state.colony.foodMonthsReserve.toFixed(1)} months`,
        `Population to feed: ${state.colony.population}`,
        `Infrastructure modules (farming): ${Math.floor(state.colony.infrastructureModules * 0.3)}`,
      ];
      break;
    case 'psychology': {
      const avgPsych = alive.reduce((s, c) => s + c.health.psychScore, 0) / alive.length;
      const depressed = alive.filter(c => c.health.psychScore < 0.5).length;
      const marsBorn = alive.filter(c => c.core.marsborn).length;
      const avgEarthContacts = alive.reduce((s, c) => s + c.social.earthContacts, 0) / alive.length;
      domainData = [
        'PSYCHOLOGICAL DATA:',
        `Colony morale: ${Math.round(state.colony.morale * 100)}% | Average psych score: ${avgPsych.toFixed(2)}`,
        `Depressed colonists (psych < 0.5): ${depressed}/${alive.length}`,
        `Mars-born: ${marsBorn} | Average Earth contacts: ${avgEarthContacts.toFixed(1)}`,
        '',
        'FEATURED COLONIST SOCIAL:',
        ...featured.slice(0, 6).map(c => `- ${c.core.name}: psych ${c.health.psychScore.toFixed(2)}, partners: ${c.social.partnerId ? 'yes' : 'no'}, children: ${c.social.childrenIds.length}, friends: ${c.social.friendIds.length}, earth contacts: ${c.social.earthContacts}`),
      ];
      break;
    }
    case 'governance':
      domainData = [
        'POLITICAL DATA:',
        `Earth dependency: ${state.politics.earthDependencyPct}%`,
        `Governance: ${state.politics.governanceStatus}`,
        `Independence pressure: ${(state.politics.independencePressure * 100).toFixed(0)}%`,
        `Mars-born population: ${alive.filter(c => c.core.marsborn).length}/${alive.length}`,
      ];
      break;
    default:
      domainData = ['No specific domain data for this department.'];
  }

  return [...header, ...research, ...colonyStatus, ...domainData].join('\n');
}

/**
 * Determine which departments should be consulted for a given turn.
 */
export function getDepartmentsForTurn(turn: number): Department[] {
  // Medical and engineering are always consulted
  const deps: Department[] = ['medical', 'engineering'];

  // Agriculture consulted for food-related crises
  if ([2, 3, 4, 8, 11, 12].includes(turn)) deps.push('agriculture');

  // Psychology consulted for human-factor crises
  if ([4, 6, 8, 9, 11, 12].includes(turn)) deps.push('psychology');

  // Governance only from turn 9 onward
  if (turn >= 9) deps.push('governance');

  return deps;
}
```

- [ ] **Step 2: Commit**

```bash
cd packages/agentos
git add examples/mars-genesis/shared/departments.ts
git commit -m "feat(mars-genesis): add department agent configs, context builders, and turn routing"
```

---

### Task 2: Orchestrator

**Files:**
- Create: `examples/mars-genesis/shared/orchestrator.ts`

- [ ] **Step 1: Create the orchestrator**

```typescript
// examples/mars-genesis/shared/orchestrator.ts

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ITool } from '@framers/agentos';
import {
  EmergentCapabilityEngine,
  EmergentJudge,
  EmergentToolRegistry,
  ComposableToolBuilder,
  SandboxedToolForge,
  ForgeToolMetaTool,
  generateText,
} from '@framers/agentos';
import type { LeaderConfig } from './types.js';
import type { Department } from './state.js';
import type { DepartmentReport, CommanderDecision, TurnArtifact } from './contracts.js';
import { SimulationKernel, type PolicyEffect } from './kernel.js';
import type { KeyPersonnel } from './colonist-generator.js';
import { SCENARIOS } from './scenarios.js';
import { getResearchPacket } from './research.js';
import { DEPARTMENT_CONFIGS, buildDepartmentContext, getDepartmentsForTurn } from './departments.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Web search tool
// ---------------------------------------------------------------------------

const webSearchTool: ITool = {
  id: 'tool.web_search',
  name: 'web_search',
  displayName: 'Web Search',
  description: 'Search the web for scientific papers, NASA data, and peer-reviewed research.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The search query' } },
    required: ['query'],
  },
  hasSideEffects: false,
  async execute(args: Record<string, unknown>) {
    const query = String(args.query || '');
    const serperKey = process.env.SERPER_API_KEY;
    if (!serperKey) return { success: false, error: 'SERPER_API_KEY not set' };
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: 5 }),
      });
      if (!res.ok) return { success: false, error: `Search ${res.status}` };
      const data = await res.json() as { organic?: Array<{ title: string; link: string; snippet: string }> };
      const results = (data.organic || []).slice(0, 5).map(r => ({ title: r.title, url: r.link, snippet: r.snippet }));
      return { success: true, output: { results, query } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
};

// ---------------------------------------------------------------------------
// Emergent engine setup
// ---------------------------------------------------------------------------

function createEmergentEngine(toolMap: Map<string, ITool>) {
  const llmCallback = async (model: string, prompt: string): Promise<string> => {
    const result = await generateText({ provider: 'openai', model: model || 'gpt-5.4', prompt });
    return result.text;
  };
  const registry = new EmergentToolRegistry();
  const judge = new EmergentJudge({ judgeModel: 'gpt-5.4', promotionModel: 'gpt-5.4', generateText: llmCallback });
  const toolExecutor = async (toolName: string, args: unknown, ctx: any) => {
    const tool = toolMap.get(toolName);
    if (!tool) return { success: false, error: `Tool "${toolName}" not found` };
    return tool.execute(args as any, ctx);
  };
  const composableBuilder = new ComposableToolBuilder(toolExecutor as any);
  const sandboxForge = new SandboxedToolForge();
  const engine = new EmergentCapabilityEngine({
    config: {
      enabled: true, maxSessionTools: 20, maxAgentTools: 50,
      sandboxTimeoutMs: 10000, sandboxMemoryMB: 128,
      promotionThreshold: { uses: 5, confidence: 0.8 },
      allowSandboxTools: true, persistSandboxSource: true,
      judgeModel: 'gpt-5.4', promotionJudgeModel: 'gpt-5.4',
    },
    composableBuilder, sandboxForge, judge, registry,
  });
  return { engine, forgeTool: new ForgeToolMetaTool(engine) };
}

function wrapForgeTool(rawForgeTool: ForgeToolMetaTool, agentId: string, sessionId: string, dept: string): ITool {
  return {
    ...(rawForgeTool as any),
    async execute(args: Record<string, unknown>, ctx: any) {
      const fixedArgs = { ...args };
      if (typeof fixedArgs.implementation === 'string') try { fixedArgs.implementation = JSON.parse(fixedArgs.implementation); } catch {}
      if (typeof fixedArgs.inputSchema === 'string') try { fixedArgs.inputSchema = JSON.parse(fixedArgs.inputSchema); } catch {}
      if (typeof fixedArgs.outputSchema === 'string') try { fixedArgs.outputSchema = JSON.parse(fixedArgs.outputSchema); } catch {}
      if (typeof fixedArgs.testCases === 'string') try { fixedArgs.testCases = JSON.parse(fixedArgs.testCases); } catch {}
      const mode = (fixedArgs.implementation as any)?.mode || '?';
      console.log(`    🔧 [${dept}] Forging "${fixedArgs.name}" (${mode})...`);
      const patchedCtx = { ...ctx, gmiId: agentId, sessionData: { ...(ctx?.sessionData ?? {}), sessionId } };
      try {
        const result = await rawForgeTool.execute(fixedArgs as any, patchedCtx);
        console.log(`    🔧 [${dept}] ${result.success ? '✓' : '✗'} "${fixedArgs.name}"`);
        return result;
      } catch (err) {
        console.log(`    🔧 [${dept}] EXCEPTION: ${err}`);
        return { success: false, error: String(err) };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Parse department report from LLM text
// ---------------------------------------------------------------------------

function parseDepartmentReport(text: string, dept: Department): DepartmentReport {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*"department"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { ...getDefaultReport(dept), ...parsed, department: dept };
    } catch {}
  }
  // Fallback: build report from free text
  const citations: DepartmentReport['citations'] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = linkRegex.exec(text)) !== null) {
    if (m[2].startsWith('http')) citations.push({ text: m[1], url: m[2], context: m[1] });
  }
  return {
    ...getDefaultReport(dept),
    summary: text.slice(0, 500),
    citations,
  };
}

function getDefaultReport(dept: Department): DepartmentReport {
  return {
    department: dept, summary: '', citations: [], risks: [], opportunities: [],
    recommendedActions: [], proposedPatches: {}, forgedToolsUsed: [],
    featuredColonistUpdates: [], confidence: 0.7, openQuestions: [],
  };
}

// ---------------------------------------------------------------------------
// Parse commander decision from LLM text
// ---------------------------------------------------------------------------

function parseCommanderDecision(text: string, depts: Department[]): CommanderDecision {
  const jsonMatch = text.match(/\{[\s\S]*"decision"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { ...getDefaultDecision(depts), ...parsed };
    } catch {}
  }
  return {
    ...getDefaultDecision(depts),
    decision: text.slice(0, 500),
    rationale: text,
  };
}

function getDefaultDecision(depts: Department[]): CommanderDecision {
  return {
    decision: '', rationale: '', departmentsConsulted: depts,
    selectedPolicies: [], rejectedPolicies: [], expectedTradeoffs: [], watchMetricsNextTurn: [],
  };
}

// ---------------------------------------------------------------------------
// Convert commander decision to policy effect
// ---------------------------------------------------------------------------

function decisionToPolicyEffect(decision: CommanderDecision, reports: DepartmentReport[], turn: number, year: number): PolicyEffect {
  const patches: PolicyEffect['patches'] = {};
  const events: PolicyEffect['events'] = [];

  // Merge proposed patches from consulted departments
  for (const r of reports) {
    if (r.proposedPatches.colony) {
      patches.colony = { ...patches.colony, ...r.proposedPatches.colony };
    }
    if (r.proposedPatches.politics) {
      patches.politics = { ...patches.politics, ...r.proposedPatches.politics };
    }
    if (r.proposedPatches.colonistUpdates) {
      patches.colonistUpdates = [...(patches.colonistUpdates || []), ...r.proposedPatches.colonistUpdates];
    }
  }

  events.push({
    turn, year, type: 'decision',
    description: decision.decision.slice(0, 200),
    data: { rationale: decision.rationale.slice(0, 300), policies: decision.selectedPolicies },
  });

  return { description: decision.decision, patches, events };
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export interface RunOptions {
  maxTurns?: number;
  liveSearch?: boolean;
}

export async function runSimulation(leader: LeaderConfig, keyPersonnel: KeyPersonnel[], opts: RunOptions = {}) {
  const { agent } = await import('@framers/agentos');
  const maxTurns = opts.maxTurns ?? 12;
  const sessionId = `mars-genesis-${leader.archetype.toLowerCase().replace(/\s+/g, '-')}`;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  MARS GENESIS v2`);
  console.log(`  Commander: ${leader.name} — "${leader.archetype}"`);
  console.log(`  Colony: ${leader.colony}`);
  console.log(`  Model: Commander=gpt-5.4 | Departments=gpt-5.4-mini | Judge=gpt-5.4`);
  console.log(`  Turns: ${maxTurns} | Live search: ${opts.liveSearch ? 'yes' : 'no (packet only)'}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Initialize kernel
  const kernel = new SimulationKernel(leader.hexaco.openness * 1000 | 0, leader.name, keyPersonnel);

  // Initialize emergent engine
  const toolMap = new Map<string, ITool>();
  toolMap.set('web_search', webSearchTool);
  const { engine, forgeTool } = createEmergentEngine(toolMap);
  const toolRegistries: Record<string, string[]> = {};

  // Create commander agent
  const commander = agent({
    provider: 'openai',
    model: 'gpt-5.4',
    instructions: leader.instructions,
    personality: {
      openness: leader.hexaco.openness,
      conscientiousness: leader.hexaco.conscientiousness,
      extraversion: leader.hexaco.extraversion,
      agreeableness: leader.hexaco.agreeableness,
      emotionality: leader.hexaco.emotionality,
      honesty: leader.hexaco.honestyHumility,
    },
    maxSteps: 5,
  });
  const cmdSession = commander.session(`${sessionId}-commander`);
  await cmdSession.send('You are the colony commander. You will receive department reports and make strategic decisions. Acknowledge.');

  // Create department agents
  const deptAgents = new Map<Department, ReturnType<typeof agent>>();
  const deptSessions = new Map<Department, any>();

  for (const cfg of DEPARTMENT_CONFIGS) {
    const wrappedForge = wrapForgeTool(forgeTool, `${sessionId}-${cfg.department}`, sessionId, cfg.department);
    const tools: ITool[] = opts.liveSearch ? [webSearchTool, wrappedForge] : [wrappedForge];
    const a = agent({
      provider: 'openai',
      model: cfg.model,
      instructions: cfg.instructions,
      tools,
      maxSteps: 8,
    });
    deptAgents.set(cfg.department, a);
    const s = a.session(`${sessionId}-${cfg.department}`);
    deptSessions.set(cfg.department, s);
  }

  // Run turns
  const turnArtifacts: TurnArtifact[] = [];
  const scenariosToRun = SCENARIOS.slice(0, maxTurns);

  for (const scenario of scenariosToRun) {
    const turn = scenario.turn;
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  Turn ${turn}/${maxTurns} — Year ${scenario.year}: ${scenario.title}`);
    console.log(`${'─'.repeat(50)}`);

    // 1. Advance kernel
    const state = kernel.advanceTurn(turn);
    const births = state.eventLog.filter(e => e.turn === turn && e.type === 'birth').length;
    const deaths = state.eventLog.filter(e => e.turn === turn && e.type === 'death').length;
    console.log(`  Progression: +${births} births, -${deaths} deaths → pop ${state.colony.population}`);

    // 2. Get research packet
    const packet = getResearchPacket(turn);

    // 3. Run department agents
    const departments = getDepartmentsForTurn(turn);
    console.log(`  Departments: ${departments.join(', ')}`);
    const reports: DepartmentReport[] = [];

    for (const dept of departments) {
      const session = deptSessions.get(dept);
      if (!session) continue;

      const context = buildDepartmentContext(dept, state, scenario, packet);
      console.log(`  [${dept}] Analyzing...`);

      try {
        const result = await session.send(context);
        const report = parseDepartmentReport(result.text, dept);
        reports.push(report);
        console.log(`  [${dept}] Done: ${report.citations.length} citations, ${report.risks.length} risks, ${report.forgedToolsUsed.length} tools forged`);

        // Track forged tools
        if (report.forgedToolsUsed.length > 0) {
          toolRegistries[dept] = [...(toolRegistries[dept] || []), ...report.forgedToolsUsed.map(t => t.name)];
        }
      } catch (err) {
        console.log(`  [${dept}] ERROR: ${err}`);
        reports.push(getDefaultReport(dept));
      }
    }

    // 4. Commander synthesizes
    const reportSummaries = reports.map(r => [
      `## ${r.department.toUpperCase()} REPORT (confidence: ${r.confidence})`,
      r.summary,
      `Risks: ${r.risks.map(r2 => `[${r2.severity}] ${r2.description}`).join('; ') || 'none'}`,
      `Recommendations: ${r.recommendedActions.join('; ') || 'none'}`,
      `Citations: ${r.citations.length}`,
      `Tools forged: ${r.forgedToolsUsed.map(t => t.name).join(', ') || 'none'}`,
    ].join('\n')).join('\n\n');

    const cmdPrompt = [
      `TURN ${turn} — YEAR ${scenario.year}: ${scenario.title}`,
      '',
      'DEPARTMENT REPORTS:',
      reportSummaries,
      '',
      `Colony: Pop ${state.colony.population} | Morale ${Math.round(state.colony.morale * 100)}% | Food ${state.colony.foodMonthsReserve.toFixed(1)}mo | Power ${state.colony.powerKw} kW`,
      '',
      'Make your decision. Return JSON: {"decision": "...", "rationale": "...", "selectedPolicies": [...], "rejectedPolicies": [...], "expectedTradeoffs": [...], "watchMetricsNextTurn": [...]}',
    ].join('\n');

    console.log(`  [commander] Deciding...`);
    const cmdResult = await cmdSession.send(cmdPrompt);
    const decision = parseCommanderDecision(cmdResult.text, departments);
    console.log(`  [commander] Decision: ${decision.decision.slice(0, 120)}...`);

    // 5. Apply policy to kernel
    const policyEffect = decisionToPolicyEffect(decision, reports, turn, scenario.year);
    kernel.applyPolicy(policyEffect);

    // 6. Record artifact
    const afterState = kernel.getState();
    turnArtifacts.push({
      turn, year: scenario.year, crisis: scenario.title,
      departmentReports: reports,
      commanderDecision: decision,
      policyEffectsApplied: decision.selectedPolicies,
      stateSnapshotAfter: {
        population: afterState.colony.population,
        morale: afterState.colony.morale,
        foodMonthsReserve: afterState.colony.foodMonthsReserve,
        infrastructureModules: afterState.colony.infrastructureModules,
        scienceOutput: afterState.colony.scienceOutput,
        births, deaths,
      },
    });

    console.log(`  State: Pop ${afterState.colony.population} | Morale ${Math.round(afterState.colony.morale * 100)}% | Food ${afterState.colony.foodMonthsReserve.toFixed(1)}mo`);
  }

  // Export
  const finalState = kernel.export();
  const output = {
    simulation: 'mars-genesis-v2',
    leader: { name: leader.name, archetype: leader.archetype, colony: leader.colony, hexaco: leader.hexaco },
    turnArtifacts,
    finalState,
    toolRegistries,
    totalCitations: turnArtifacts.reduce((s, t) => s + t.departmentReports.reduce((s2, r) => s2 + r.citations.length, 0), 0),
    totalToolsForged: Object.values(toolRegistries).flat().length,
  };

  const outputDir = resolve(__dirname, '..', 'output');
  mkdirSync(outputDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const tag = leader.archetype.toLowerCase().replace(/\s+/g, '-');
  const outputPath = resolve(outputDir, `v2-${tag}-${ts}.json`);
  writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  SIMULATION COMPLETE — ${leader.name}`);
  console.log(`  Output: ${outputPath}`);
  console.log(`  Turns: ${turnArtifacts.length}`);
  console.log(`  Citations: ${output.totalCitations}`);
  console.log(`  Tools forged: ${output.totalToolsForged}`);
  console.log(`  Tool registries: ${JSON.stringify(toolRegistries)}`);
  console.log(`  Final pop: ${finalState.colony.population} | Morale: ${Math.round(finalState.colony.morale * 100)}%`);
  console.log(`${'═'.repeat(60)}\n`);

  // Cleanup
  engine.cleanupSession(sessionId);
  await commander.close();
  for (const a of deptAgents.values()) await a.close();

  return output;
}
```

- [ ] **Step 2: Commit**

```bash
git add examples/mars-genesis/shared/orchestrator.ts
git commit -m "feat(mars-genesis): add multi-agent orchestrator with department routing and kernel integration"
```

---

### Task 3: Update Entry Points

**Files:**
- Modify: `examples/mars-genesis/mars-genesis-visionary.ts`
- Modify: `examples/mars-genesis/mars-genesis-engineer.ts`

- [ ] **Step 1: Update Visionary entry point for v2**

```typescript
// examples/mars-genesis/mars-genesis-visionary.ts
/**
 * Mars Genesis v2: Commander Aria Chen — "The Visionary"
 *
 * Multi-agent Mars colony simulation with deterministic kernel,
 * 5 department agents, emergent tool forging, and HEXACO personality.
 *
 * Run:
 *   cd packages/agentos
 *   OPENAI_API_KEY=... SERPER_API_KEY=... npx tsx examples/mars-genesis/mars-genesis-visionary.ts [turns]
 *
 * Examples:
 *   npx tsx examples/mars-genesis/mars-genesis-visionary.ts 3          # smoke test
 *   npx tsx examples/mars-genesis/mars-genesis-visionary.ts             # full 12 turns
 *   npx tsx examples/mars-genesis/mars-genesis-visionary.ts 12 --live  # with live search
 */

import { runSimulation } from './shared/orchestrator.js';

const VISIONARY = {
  name: 'Aria Chen',
  archetype: 'The Visionary',
  colony: 'Ares Horizon',
  hexaco: { openness: 0.95, conscientiousness: 0.35, extraversion: 0.85, agreeableness: 0.55, emotionality: 0.3, honestyHumility: 0.65 },
  instructions: `You are Commander Aria Chen. You believe in bold expansion and discovery. You accept calculated risks. You inspire through vision. When departments disagree, you favor the option with higher upside even if riskier. Respond with JSON.`,
};

const KEY_PERSONNEL = [
  { name: 'Dr. Yuki Tanaka', department: 'medical' as const, role: 'Chief Medical Officer', specialization: 'Radiation Medicine', age: 38, featured: true },
  { name: 'Erik Lindqvist', department: 'engineering' as const, role: 'Chief Engineer', specialization: 'Structural Engineering', age: 45, featured: true },
  { name: 'Amara Osei', department: 'agriculture' as const, role: 'Head of Agriculture', specialization: 'Hydroponics', age: 34, featured: true },
  { name: 'Dr. Priya Singh', department: 'psychology' as const, role: 'Colony Psychologist', specialization: 'Clinical Psychology', age: 41, featured: true },
  { name: 'Carlos Fernandez', department: 'science' as const, role: 'Chief Scientist', specialization: 'Geology', age: 50, featured: true },
];

const maxTurns = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;
const liveSearch = process.argv.includes('--live');

runSimulation(VISIONARY, KEY_PERSONNEL, { maxTurns, liveSearch }).catch((err) => {
  console.error('Simulation failed:', err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Update Engineer entry point for v2**

```typescript
// examples/mars-genesis/mars-genesis-engineer.ts
/**
 * Mars Genesis v2: Commander Dietrich Voss — "The Engineer"
 *
 * Multi-agent Mars colony simulation with deterministic kernel,
 * 5 department agents, emergent tool forging, and HEXACO personality.
 *
 * Run:
 *   cd packages/agentos
 *   OPENAI_API_KEY=... SERPER_API_KEY=... npx tsx examples/mars-genesis/mars-genesis-engineer.ts [turns]
 */

import { runSimulation } from './shared/orchestrator.js';

const ENGINEER = {
  name: 'Dietrich Voss',
  archetype: 'The Engineer',
  colony: 'Meridian Base',
  hexaco: { openness: 0.25, conscientiousness: 0.97, extraversion: 0.3, agreeableness: 0.45, emotionality: 0.7, honestyHumility: 0.9 },
  instructions: `You are Commander Dietrich Voss. You believe in engineering discipline and safety margins. You demand data before decisions. When departments disagree, you favor the option with lower risk even if less ambitious. Respond with JSON.`,
};

const KEY_PERSONNEL = [
  { name: 'Dr. Yuki Tanaka', department: 'medical' as const, role: 'Chief Medical Officer', specialization: 'Radiation Medicine', age: 38, featured: true },
  { name: 'Erik Lindqvist', department: 'engineering' as const, role: 'Chief Engineer', specialization: 'Structural Engineering', age: 45, featured: true },
  { name: 'Amara Osei', department: 'agriculture' as const, role: 'Head of Agriculture', specialization: 'Hydroponics', age: 34, featured: true },
  { name: 'Dr. Priya Singh', department: 'psychology' as const, role: 'Colony Psychologist', specialization: 'Clinical Psychology', age: 41, featured: true },
  { name: 'Carlos Fernandez', department: 'science' as const, role: 'Chief Scientist', specialization: 'Geology', age: 50, featured: true },
];

const maxTurns = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;
const liveSearch = process.argv.includes('--live');

runSimulation(ENGINEER, KEY_PERSONNEL, { maxTurns, liveSearch }).catch((err) => {
  console.error('Simulation failed:', err);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Commit**

```bash
git add examples/mars-genesis/mars-genesis-visionary.ts examples/mars-genesis/mars-genesis-engineer.ts
git commit -m "feat(mars-genesis): update entry points for v2 multi-agent orchestrator"
```

---

### Task 4: Smoke Test

- [ ] **Step 1: TypeScript check**

```bash
cd packages/agentos
npx tsx --check examples/mars-genesis/mars-genesis-visionary.ts
npx tsx --check examples/mars-genesis/mars-genesis-engineer.ts
```

Expected: no errors.

- [ ] **Step 2: Run 1-turn smoke test**

```bash
OPENAI_API_KEY=... npx tsx examples/mars-genesis/mars-genesis-visionary.ts 1
```

Expected:
- Kernel advances to Turn 1
- Medical and Engineering departments run
- Each department produces a report
- Commander makes a decision
- JSON output written to `output/v2-the-visionary-*.json`

- [ ] **Step 3: Commit any fixes**

```bash
git add -u examples/mars-genesis/
git commit -m "fix(mars-genesis): smoke test adjustments"
git push origin master
```
