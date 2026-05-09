/**
 * @file costs.ts
 * @description Cost-points for ingest strategies.
 *
 * Unlike retrieval where Phase B measurements give us per-category
 * accuracy + cost data, ingest cost is dominated by LLM-call counts at
 * write time and is much more workload-dependent (a long-article may
 * have 1 summarize call; a long-conversation may have 30 observation
 * extraction calls). The numbers below are illustrative averages; for
 * production-budget enforcement, consumers should override with measured
 * values from their own workload.
 *
 * @module @framers/agentos/ingest-router/costs
 */

import type { IngestStrategyId } from './routing-tables.js';

/**
 * Cost-point for one ingest strategy. The router uses this to apply
 * budget constraints + pick a cheaper fallback when a strategy doesn't
 * fit a per-ingest USD ceiling.
 */
export interface IngestStrategyCostPoint {
  readonly strategy: IngestStrategyId;
  /** Average USD per ingest event (one session / one document). */
  readonly avgCostPerIngest: number;
  /**
   * Average latency per ingest in milliseconds. For short content this
   * is roughly proportional to the number of LLM calls.
   */
  readonly avgLatencyMs: number;
  /**
   * Free-form label describing what this strategy actually writes
   * (chunks, summarized chunks, observations, fact triples, etc.).
   * Useful for telemetry + dashboards.
   */
  readonly outputDescription: string;
}

export const RAW_CHUNKS_COST: IngestStrategyCostPoint = Object.freeze({
  strategy: 'raw-chunks' as const,
  avgCostPerIngest: 0.0001, // embedding-only
  avgLatencyMs: 200,
  outputDescription: 'raw turns/chunks with embeddings',
}) as IngestStrategyCostPoint;

export const SUMMARIZED_COST: IngestStrategyCostPoint = Object.freeze({
  strategy: 'summarized' as const,
  avgCostPerIngest: 0.005, // one LLM summarize call per session/document
  avgLatencyMs: 1500,
  outputDescription: 'session/document summary prefixed to every chunk',
}) as IngestStrategyCostPoint;

export const OBSERVATIONAL_COST: IngestStrategyCostPoint = Object.freeze({
  strategy: 'observational' as const,
  avgCostPerIngest: 0.020, // multi-call observation extraction
  avgLatencyMs: 6000,
  outputDescription: 'structured observation log replacing raw turns',
}) as IngestStrategyCostPoint;

export const FACT_GRAPH_COST: IngestStrategyCostPoint = Object.freeze({
  strategy: 'fact-graph' as const,
  avgCostPerIngest: 0.015, // triple extraction
  avgLatencyMs: 4500,
  outputDescription: 'fact triples + entity-relation graph',
}) as IngestStrategyCostPoint;

export const HYBRID_COST: IngestStrategyCostPoint = Object.freeze({
  strategy: 'hybrid' as const,
  avgCostPerIngest: 0.030, // raw + summarized + observational
  avgLatencyMs: 8000,
  outputDescription: 'parallel raw-chunks + summarized + observational outputs',
}) as IngestStrategyCostPoint;

export const SKIP_COST: IngestStrategyCostPoint = Object.freeze({
  strategy: 'skip' as const,
  avgCostPerIngest: 0,
  avgLatencyMs: 0,
  outputDescription: 'content discarded; nothing written to memory',
}) as IngestStrategyCostPoint;

/**
 * Default cost-points registry. Override per workload by passing a
 * custom map to {@link IngestRouter} at construction.
 */
export const DEFAULT_INGEST_COSTS: Readonly<
  Record<IngestStrategyId, IngestStrategyCostPoint>
> = Object.freeze({
  'raw-chunks': RAW_CHUNKS_COST,
  summarized: SUMMARIZED_COST,
  observational: OBSERVATIONAL_COST,
  'fact-graph': FACT_GRAPH_COST,
  hybrid: HYBRID_COST,
  skip: SKIP_COST,
});
