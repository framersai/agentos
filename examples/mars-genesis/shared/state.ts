export type Department = 'medical' | 'engineering' | 'agriculture' | 'science' | 'administration' | 'psychology' | 'governance';

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
  hexaco: HexacoProfile;
  promotion?: PromotionRecord;
  hexacoHistory: HexacoSnapshot[];
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
