/**
 * @file usageLedger.ts
 * Optional durable usage ledger for the lightweight AgentOS helper APIs.
 *
 * Library consumers can enable persistence explicitly per call/session or by
 * setting `AGENTOS_USAGE_LEDGER_PATH` / `WUNDERLAND_USAGE_LEDGER_PATH`. When disabled, helper APIs keep their
 * current behavior and do not write to disk.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { UsageLedger } from '../../core/utils/usage/UsageLedger.js';

export interface AgentOSUsageLedgerOptions {
  /** Enable persistence using the shared default path under `~/.framers/usage-ledger.jsonl`. */
  enabled?: boolean;
  /** Explicit path to the append-only JSONL ledger file. */
  path?: string;
  /** Session identifier used to group related helper calls. Defaults to `"global"`. */
  sessionId?: string;
  /** Optional persona identifier for callers layering persona-specific usage views. */
  personaId?: string;
  /** Optional source label such as `"generateText"` or `"agent.session.stream"`. */
  source?: string;
}

export interface AgentOSUsageEvent {
  recordedAt: string;
  sessionId: string;
  personaId?: string;
  providerId?: string;
  modelId?: string;
  userId?: string;
  tenantId?: string;
  source?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUSD?: number;
}

export interface AgentOSUsageAggregate {
  sessionId?: string;
  personaId?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUSD: number;
  calls: number;
}

export interface AgentOSUsageRecordInput {
  providerId?: string;
  modelId?: string;
  userId?: string;
  tenantId?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUSD?: number;
  };
  options?: AgentOSUsageLedgerOptions;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ReadAgentOSUsageOptions extends Pick<AgentOSUsageLedgerOptions, 'enabled' | 'path' | 'sessionId' | 'personaId'> {}

const DEFAULT_LEDGER_DIR = '.framers';
const DEFAULT_LEDGER_FILE = 'usage-ledger.jsonl';

export function getDefaultAgentOSUsageLedgerPath(): string {
  return path.join(os.homedir(), DEFAULT_LEDGER_DIR, DEFAULT_LEDGER_FILE);
}

function hasMeaningfulUsage(usage?: AgentOSUsageRecordInput['usage']): boolean {
  if (!usage) return false;
  return [
    usage.promptTokens,
    usage.completionTokens,
    usage.totalTokens,
    usage.costUSD,
  ].some((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
}

function toAggregate(events: AgentOSUsageEvent[], requestedSessionId?: string, requestedPersonaId?: string): AgentOSUsageAggregate {
  const ledger = new UsageLedger();
  for (const event of events) {
    ledger.ingestUsage(
      {
        sessionId: event.sessionId,
        personaId: event.personaId,
        providerId: event.providerId,
        modelId: event.modelId,
      },
      {
        promptTokens: event.promptTokens,
        completionTokens: event.completionTokens,
        totalTokens: event.totalTokens,
        costUSD: event.costUSD,
        modelId: event.modelId,
        isFinal: true,
      },
    );
  }

  const summaries = requestedSessionId
    ? ledger.getSummariesBySession(requestedSessionId)
    : ledger.listAllSummaries();

  return summaries.reduce<AgentOSUsageAggregate>(
    (aggregate, summary) => ({
      sessionId: requestedSessionId,
      personaId: requestedPersonaId,
      promptTokens: aggregate.promptTokens + summary.promptTokens,
      completionTokens: aggregate.completionTokens + summary.completionTokens,
      totalTokens: aggregate.totalTokens + summary.totalTokens,
      costUSD: aggregate.costUSD + summary.costUSD,
      calls: aggregate.calls + summary.calls,
    }),
    {
      sessionId: requestedSessionId,
      personaId: requestedPersonaId,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUSD: 0,
      calls: 0,
    },
  );
}

export function resolveAgentOSUsageLedgerPath(options?: Pick<AgentOSUsageLedgerOptions, 'enabled' | 'path'>): string | undefined {
  if (options?.path?.trim()) {
    return path.resolve(options.path);
  }

  const envPath = process.env.AGENTOS_USAGE_LEDGER_PATH?.trim()
    || process.env.WUNDERLAND_USAGE_LEDGER_PATH?.trim();
  if (envPath) {
    return path.resolve(envPath);
  }

  if (options?.enabled) {
    return getDefaultAgentOSUsageLedgerPath();
  }

  return undefined;
}

export async function readRecordedAgentOSUsageEvents(options?: ReadAgentOSUsageOptions): Promise<AgentOSUsageEvent[]> {
  const ledgerPath = resolveAgentOSUsageLedgerPath(options);
  if (!ledgerPath) return [];

  let raw = '';
  try {
    raw = await fs.readFile(ledgerPath, 'utf8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as AgentOSUsageEvent;
      } catch {
        return undefined;
      }
    })
    .filter((event): event is AgentOSUsageEvent => Boolean(event));
}

export async function recordAgentOSUsage(input: AgentOSUsageRecordInput): Promise<boolean> {
  const ledgerPath = resolveAgentOSUsageLedgerPath(input.options);
  if (!ledgerPath) return false;
  if (!input.providerId && !input.modelId) return false;
  if (!hasMeaningfulUsage(input.usage)) return false;

  const event: AgentOSUsageEvent = {
    recordedAt: new Date().toISOString(),
    sessionId: input.options?.sessionId ?? 'global',
    personaId: input.options?.personaId,
    providerId: input.providerId,
    modelId: input.modelId,
    userId: input.userId,
    tenantId: input.tenantId,
    source: input.options?.source,
    promptTokens: input.usage?.promptTokens ?? 0,
    completionTokens: input.usage?.completionTokens ?? 0,
    totalTokens: input.usage?.totalTokens ?? 0,
    costUSD: input.usage?.costUSD,
  };

  await fs.mkdir(path.dirname(ledgerPath), { recursive: true, mode: 0o700 });
  await fs.appendFile(ledgerPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  return true;
}

export async function getRecordedAgentOSUsage(options?: ReadAgentOSUsageOptions): Promise<AgentOSUsageAggregate> {
  const events = await readRecordedAgentOSUsageEvents(options);
  const filtered = events.filter((event) => {
    if (options?.sessionId && event.sessionId !== options.sessionId) return false;
    if (options?.personaId && event.personaId !== options.personaId) return false;
    return true;
  });

  return toAggregate(filtered, options?.sessionId, options?.personaId);
}

export async function clearRecordedAgentOSUsage(options?: Pick<AgentOSUsageLedgerOptions, 'enabled' | 'path'>): Promise<void> {
  const ledgerPath = resolveAgentOSUsageLedgerPath(options);
  if (!ledgerPath) return;
  await fs.rm(ledgerPath, { force: true });
}
