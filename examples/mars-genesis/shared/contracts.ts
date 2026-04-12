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

export interface PromotionDecision {
  promotions: Array<{
    colonistId: string;
    department: Department;
    role: string;
    reason: string;
  }>;
}
