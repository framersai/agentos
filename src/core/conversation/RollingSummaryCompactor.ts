import type { ChatMessage, ModelCompletionOptions } from '../llm/providers/IProvider';
import type { ConversationMessage } from './ConversationMessage';
// No runtime imports needed from ConversationMessage (type-only above).

export interface RollingSummaryCompactionConfig {
  enabled: boolean;
  /**
   * Model id used for compaction.
   *
   * Note: model ids are provider-specific:
   * - OpenAI provider: `gpt-4o-mini`
   * - OpenRouter provider: `openai/gpt-4o-mini`
   *
   * Keep this cheap/fast by default; it runs occasionally.
   */
  modelId: string;
  /** Provider id override (optional). */
  providerId?: string;
  /** Minimum time between compaction passes per conversation. */
  cooldownMs: number;
  /** Preserve the first N messages verbatim (usually system + initial user). */
  headMessagesToKeep: number;
  /** Preserve the last N messages verbatim (fresh context). */
  tailMessagesToKeep: number;
  /** Minimum number of messages to summarize in a pass. */
  minMessagesToSummarize: number;
  /** Maximum number of messages summarized per pass (older-first). */
  maxMessagesToSummarizePerPass: number;
  /** Maximum output tokens for the compactor model. */
  maxOutputTokens: number;
  /** Optional temperature for the compactor model. */
  temperature?: number;
}

export interface RollingSummaryCompactionResult {
  enabled: boolean;
  didCompact: boolean;
  summaryText: string | null;
  summaryJson: any | null;
  summaryUptoTimestamp: number | null;
  summaryUpdatedAt: number | null;
  compactedMessageCount?: number;
  reason?: string;
}

export type RollingSummaryLlmCaller = (input: {
  providerId?: string;
  modelId: string;
  messages: ChatMessage[];
  options: ModelCompletionOptions;
}) => Promise<string>;

export const DEFAULT_ROLLING_SUMMARY_COMPACTION_CONFIG: RollingSummaryCompactionConfig = {
  enabled: false,
  modelId: 'gpt-4o-mini',
  cooldownMs: 60_000,
  headMessagesToKeep: 2,
  tailMessagesToKeep: 12,
  minMessagesToSummarize: 12,
  maxMessagesToSummarizePerPass: 48,
  maxOutputTokens: 900,
  temperature: 0.1,
};

export const DEFAULT_ROLLING_SUMMARY_SYSTEM_PROMPT_V1 = [
  'You are AgentOS Rolling Memory Compactor.',
  '',
  'Goal: Update a rolling memory summary + structured memory JSON from an existing summary and new conversation messages.',
  '',
  'You MUST output a single JSON object and nothing else.',
  '',
  'Output JSON schema (keys required):',
  '{',
  '  "summary_markdown": string,',
  '  "memory_json": {',
  '    "facts": Array<{ "text": string, "confidence"?: number, "sources"?: string[] }>,',
  '    "preferences": Array<{ "text": string, "sources"?: string[] }>,',
  '    "people": Array<{ "name": string, "notes"?: string, "sources"?: string[] }>,',
  '    "projects": Array<{ "name": string, "status"?: string, "notes"?: string, "sources"?: string[] }>,',
  '    "decisions": Array<{ "text": string, "sources"?: string[] }>,',
  '    "open_loops": Array<{ "text": string, "sources"?: string[] }>,',
  '    "todo": Array<{ "text": string, "sources"?: string[] }>,',
  '    "tags": string[]',
  '  }',
  '}',
  '',
  'Rules:',
  '- Prefer correctness over verbosity.',
  '- Never invent facts; if unsure, omit.',
  '- Keep "summary_markdown" concise (<= ~20 bullets total).',
  '- Use source message ids in "sources" when helpful.',
].join('\n');

type RollingSummaryState = {
  updatedAt?: number | null;
  summaryText?: string | null;
  summaryJson?: any | null;
  summaryUptoTimestamp?: number | null;
};

type ParsedCompactorOutput = {
  summary_markdown?: unknown;
  memory_json?: unknown;
};

function safeJsonParse(value: string): any | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractJsonObject(text: string): any | null {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const direct = safeJsonParse(trimmed);
  if (direct) return direct;

  // Try fenced block
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    const fenced = safeJsonParse(fenceMatch[1].trim());
    if (fenced) return fenced;
  }

  // Try substring from first { to last }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const sliced = safeJsonParse(trimmed.slice(first, last + 1));
    if (sliced) return sliced;
  }
  return null;
}

function normalizeContentForCompactor(message: ConversationMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    const parts = message.content
      .map((part: any) => {
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.type === 'string') return `[${part.type}]`;
        return '[part]';
      })
      .filter(Boolean);
    return parts.join('\n');
  }
  if (message.content === null) {
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolNames = message.tool_calls.map((tc) => tc.name).filter(Boolean);
      return toolNames.length > 0 ? `[tool_calls:${toolNames.join(',')}]` : '[tool_calls]';
    }
    return '';
  }
  try {
    return JSON.stringify(message.content);
  } catch {
    return String(message.content);
  }
}

function isEligibleForRollingSummary(message: ConversationMessage): boolean {
  if (message.role === 'thought' || message.role === 'error' || message.role === 'summary') {
    return false;
  }
  const content = normalizeContentForCompactor(message).trim();
  return content.length > 0;
}

function buildTurnsForCompactor(messages: ConversationMessage[]): Array<{ id: string; role: string; name?: string; content: string }> {
  return messages
    .map((m) => ({
      id: m.id,
      role: m.role,
      name: m.name,
      content: normalizeContentForCompactor(m).trim(),
    }))
    .filter((m) => m.content.length > 0);
}

function resolveSystemPrompt(systemPrompt?: string): string {
  return (systemPrompt && systemPrompt.trim()) ? systemPrompt.trim() : DEFAULT_ROLLING_SUMMARY_SYSTEM_PROMPT_V1;
}

function resolveStateKey(stateKey?: string): string {
  return (stateKey && stateKey.trim()) ? stateKey.trim() : 'rollingSummaryState';
}

export async function maybeCompactConversationMessages(params: {
  messages: ConversationMessage[];
  sessionMetadata: Record<string, any>;
  config: RollingSummaryCompactionConfig;
  llmCaller: RollingSummaryLlmCaller;
  systemPrompt?: string;
  stateKey?: string;
  now?: number;
}): Promise<
  RollingSummaryCompactionResult & {
    updatedSessionMetadata?: Record<string, any>;
  }
> {
  const { config } = params;
  const now = typeof params.now === 'number' ? params.now : Date.now();
  const stateKey = resolveStateKey(params.stateKey);

  if (!config.enabled) {
    const state = params.sessionMetadata?.[stateKey] as RollingSummaryState | undefined;
    return {
      enabled: false,
      didCompact: false,
      summaryText: state?.summaryText ?? null,
      summaryJson: state?.summaryJson ?? null,
      summaryUptoTimestamp: typeof state?.summaryUptoTimestamp === 'number' ? state.summaryUptoTimestamp : null,
      summaryUpdatedAt: state?.updatedAt ?? null,
      reason: 'disabled',
    };
  }

  const priorState = (params.sessionMetadata?.[stateKey] as RollingSummaryState | undefined) ?? {};
  const lastUpdatedAt = typeof priorState.updatedAt === 'number' ? priorState.updatedAt : null;
  const summaryUptoTimestamp = typeof priorState.summaryUptoTimestamp === 'number' ? priorState.summaryUptoTimestamp : null;
  if (lastUpdatedAt && now - lastUpdatedAt < Math.max(0, config.cooldownMs)) {
    return {
      enabled: true,
      didCompact: false,
      summaryText: priorState.summaryText ?? null,
      summaryJson: priorState.summaryJson ?? null,
      summaryUptoTimestamp,
      summaryUpdatedAt: lastUpdatedAt,
      reason: 'cooldown',
    };
  }

  const messages = params.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      enabled: true,
      didCompact: false,
      summaryText: priorState.summaryText ?? null,
      summaryJson: priorState.summaryJson ?? null,
      summaryUptoTimestamp,
      summaryUpdatedAt: lastUpdatedAt,
      reason: 'no_messages',
    };
  }

  const headCount = Math.max(0, config.headMessagesToKeep);
  const tailCount = Math.max(0, config.tailMessagesToKeep);
  const afterTimestamp = typeof summaryUptoTimestamp === 'number' ? summaryUptoTimestamp : undefined;
  const eligible = messages.filter(isEligibleForRollingSummary);
  const unsummarized = afterTimestamp
    ? eligible.filter((m) => m.timestamp > afterTimestamp)
    : eligible;

  const effectiveHead = Math.min(headCount, unsummarized.length);
  const remainingAfterHead = Math.max(0, unsummarized.length - effectiveHead);
  const effectiveTail = Math.min(tailCount, remainingAfterHead);

  const middleStart = effectiveHead;
  const middleEnd = unsummarized.length - effectiveTail;
  const candidates = middleEnd > middleStart ? unsummarized.slice(middleStart, middleEnd) : [];

  const limitedCandidates = candidates.slice(0, Math.max(1, config.maxMessagesToSummarizePerPass));

  if (limitedCandidates.length < Math.max(1, config.minMessagesToSummarize)) {
    return {
      enabled: true,
      didCompact: false,
      summaryText: priorState.summaryText ?? null,
      summaryJson: priorState.summaryJson ?? null,
      summaryUptoTimestamp,
      summaryUpdatedAt: lastUpdatedAt,
      reason: 'below_threshold',
    };
  }

  const previousSummaryText = priorState.summaryText ?? null;
  const previousSummaryJson = priorState.summaryJson ?? null;

  const compactorInput = {
    previous: {
      summary_markdown: previousSummaryText,
      memory_json: previousSummaryJson,
    },
    new_turns: buildTurnsForCompactor(limitedCandidates),
  };

  const systemPrompt = resolveSystemPrompt(params.systemPrompt);
  const userPrompt = `Update rolling memory.\n\nINPUT_JSON:\n${JSON.stringify(compactorInput, null, 2)}`;

  const raw = await params.llmCaller({
    providerId: config.providerId,
    modelId: config.modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    options: {
      temperature: typeof config.temperature === 'number' ? config.temperature : 0.1,
      maxTokens: Math.max(64, config.maxOutputTokens),
      responseFormat: { type: 'json_object' },
    },
  });

  const parsed = extractJsonObject(raw) as ParsedCompactorOutput | null;
  const summaryText =
    parsed && typeof parsed.summary_markdown === 'string'
      ? parsed.summary_markdown.trim()
      : raw?.trim() || '';

  const summaryJson = parsed && parsed.memory_json && typeof parsed.memory_json === 'object'
    ? parsed.memory_json
    : null;

  if (!summaryText) {
    return {
      enabled: true,
      didCompact: false,
      summaryText: priorState.summaryText ?? null,
      summaryJson: priorState.summaryJson ?? null,
      summaryUptoTimestamp,
      summaryUpdatedAt: lastUpdatedAt,
      reason: 'empty_summary',
    };
  }

  const nextSummaryUptoTimestamp = limitedCandidates[limitedCandidates.length - 1]?.timestamp ?? summaryUptoTimestamp;
  const updatedSessionMetadata: Record<string, any> = {
    ...(params.sessionMetadata || {}),
    [stateKey]: {
      updatedAt: now,
      summaryText,
      summaryJson,
      summaryUptoTimestamp: typeof nextSummaryUptoTimestamp === 'number' ? nextSummaryUptoTimestamp : null,
    } satisfies RollingSummaryState,
  };

  return {
    enabled: true,
    didCompact: true,
    summaryText,
    summaryJson,
    summaryUptoTimestamp: typeof nextSummaryUptoTimestamp === 'number' ? nextSummaryUptoTimestamp : null,
    summaryUpdatedAt: now,
    compactedMessageCount: limitedCandidates.length,
    updatedSessionMetadata,
  };
}
