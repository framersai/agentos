export interface HexacoProfile {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  emotionality: number;
  honestyHumility: number;
}

export interface LeaderConfig {
  name: string;
  archetype: string;
  colony: string;
  hexaco: HexacoProfile;
  instructions: string;
}

export interface Citation {
  text: string;
  url: string;
  doi?: string;
  context: string;
}

export interface ForgedToolRecord {
  name: string;
  mode: 'compose' | 'sandbox';
  description: string;
  confidence: number;
  judgeVerdict: 'approved' | 'rejected';
}

export interface ColonySnapshot {
  population: number;
  waterLitersPerDay: number;
  foodMonthsReserve: number;
  powerKw: number;
  morale: number;
  infrastructureModules: number;
  scienceOutput: number;
  unplannedDeaths: number;
  toolsForgedTotal: number;
}

export interface TurnResult {
  turn: number;
  year: number;
  title: string;
  crisis: string;
  decision: string;
  reasoning: string;
  citations: Citation[];
  toolsForged: ForgedToolRecord[];
  snapshot: ColonySnapshot;
  rawResponse: string;
}

export interface SimulationLog {
  simulation: 'mars-genesis';
  version: '1.0.0';
  startedAt: string;
  completedAt: string;
  leader: Omit<LeaderConfig, 'instructions'>;
  turns: TurnResult[];
  finalAssessment: {
    population: number;
    toolsForged: number;
    unplannedDeaths: number;
    scienceOutput: number;
    infrastructureModules: number;
    morale: number;
  };
}

export interface Scenario {
  turn: number;
  year: number;
  title: string;
  crisis: string;
  researchKeywords: string[];
  snapshotHints: Partial<ColonySnapshot>;
}
