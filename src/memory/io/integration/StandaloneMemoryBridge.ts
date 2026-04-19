/**
 * @fileoverview Adapters that let the standalone SQLite-first `Memory`
 * facade participate in AgentOS long-term memory flows.
 *
 * These bridges intentionally use the public `Memory` API so the same memory
 * instance can power:
 * - agent-editable memory tools
 * - prompt-time long-term memory retrieval
 * - rolling-summary persistence
 *
 * @module agentos/memory/integration/StandaloneMemoryBridge
 */

import type {
  LongTermMemoryFeedbackInput,
  ILongTermMemoryRetriever,
  LongTermMemoryRetrievalInput,
  LongTermMemoryRetrievalResult,
} from '../../../core/conversation/ILongTermMemoryRetriever.js';
import type {
  IRollingSummaryMemorySink,
  RollingSummaryMemoryUpdate,
} from '../../../core/conversation/IRollingSummaryMemorySink.js';
import {
  DEFAULT_LONG_TERM_MEMORY_POLICY,
  type ResolvedLongTermMemoryPolicy,
  type RollingSummaryMemoryCategory,
} from '../../../core/conversation/LongTermMemoryPolicy.js';
import type { Memory } from '../../io/facade/Memory.js';
import type { ScoredTrace, RememberOptions, RecallOptions } from '../../io/facade/index.js';
import type { MemoryTrace } from '../../core/types.js';

type RuntimeStandaloneMemory = Pick<Memory, 'remember' | 'forget'> &
  Partial<Pick<Memory, 'close'>>;

type FeedbackCapableLongTermMemory = Pick<Memory, 'recall'> &
  Partial<Pick<Memory, 'feedbackFromResponse'>>;

type MemoryScopeTarget = {
  key: string;
  label: 'conversation' | 'persona' | 'user' | 'organization';
  memoryScope: 'thread' | 'persona' | 'user' | 'organization';
  scopeId: string;
};

type AtomicDoc = {
  key: string;
  content: string;
  tags: string[];
  entities: string[];
};

const DEFAULT_BASE_TAGS = ['agentos', 'long_term_memory'];
const CATEGORY_ORDER: RollingSummaryMemoryCategory[] = [
  'facts',
  'preferences',
  'people',
  'projects',
  'decisions',
  'open_loops',
  'todo',
  'tags',
];

export interface StandaloneMemoryLongTermRetrieverOptions {
  /**
   * Fallback result limit for scopes that do not have an explicit cap.
   * @default 4
   */
  defaultLimitPerScope?: number;

  /**
   * Conversation-scope cap. `topKByScope` only covers user/persona/org.
   * @default 4
   */
  conversationLimit?: number;

  /**
   * Include markdown headings for each scope block in the returned context.
   * @default true
   */
  includeScopeHeadings?: boolean;
}

export interface StandaloneMemoryRollingSummarySinkOptions {
  /**
   * Tags added to every persisted rolling-memory trace.
   * @default ['agentos', 'long_term_memory']
   */
  baseTags?: string[];

  /**
   * Importance assigned to summary snapshot traces.
   * @default 0.9
   */
  summaryImportance?: number;

  /**
   * Importance assigned to atomic `memory_json` item traces.
   * @default 1.0
   */
  atomicDocImportance?: number;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeText(value: unknown): string | null {
  return nonEmptyString(value);
}

function formatPeopleEntry(person: unknown): { content: string; entities: string[] } | null {
  if (typeof person !== 'object' || person === null) return null;
  const name = nonEmptyString((person as any).name);
  const notes = nonEmptyString((person as any).notes);
  if (!name) return null;
  return {
    content: notes ? `Person: ${name}. ${notes}` : `Person: ${name}.`,
    entities: [name],
  };
}

function formatProjectEntry(project: unknown): { content: string; entities: string[] } | null {
  if (typeof project !== 'object' || project === null) return null;
  const name = nonEmptyString((project as any).name);
  const status = nonEmptyString((project as any).status);
  const notes = nonEmptyString((project as any).notes);
  if (!name) return null;

  const parts = [`Project: ${name}.`];
  if (status) parts.push(`Status: ${status}.`);
  if (notes) parts.push(notes);

  return {
    content: parts.join(' ').trim(),
    entities: [name],
  };
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function buildStandaloneMemoryPersonaScopeId(userId: string, personaId: string): string {
  return `${userId}::${personaId}`;
}

function resolveScopeTargets(args: {
  userId: string;
  organizationId?: string;
  conversationId: string;
  personaId: string;
  policy: ResolvedLongTermMemoryPolicy;
}): MemoryScopeTarget[] {
  const targets: MemoryScopeTarget[] = [];
  const { userId, organizationId, conversationId, personaId, policy } = args;

  if (policy.scopes.conversation && conversationId) {
    targets.push({
      key: `thread:${conversationId}`,
      label: 'conversation',
      memoryScope: 'thread',
      scopeId: conversationId,
    });
  }

  if (policy.scopes.persona && userId && personaId) {
    targets.push({
      key: `persona:${buildStandaloneMemoryPersonaScopeId(userId, personaId)}`,
      label: 'persona',
      memoryScope: 'persona',
      scopeId: buildStandaloneMemoryPersonaScopeId(userId, personaId),
    });
  }

  if (policy.scopes.user && userId) {
    targets.push({
      key: `user:${userId}`,
      label: 'user',
      memoryScope: 'user',
      scopeId: userId,
    });
  }

  if (
    policy.scopes.organization &&
    policy.shareWithOrganization &&
    organizationId
  ) {
    targets.push({
      key: `organization:${organizationId}`,
      label: 'organization',
      memoryScope: 'organization',
      scopeId: organizationId,
    });
  }

  return targets;
}

function getScopeLimit(
  target: MemoryScopeTarget,
  input: LongTermMemoryRetrievalInput,
  options: Required<StandaloneMemoryLongTermRetrieverOptions>,
): number {
  if (target.label === 'conversation') {
    return options.conversationLimit;
  }

  if (target.label === 'user') {
    return input.topKByScope?.user ?? options.defaultLimitPerScope;
  }
  if (target.label === 'persona') {
    return input.topKByScope?.persona ?? options.defaultLimitPerScope;
  }
  if (target.label === 'organization') {
    return input.topKByScope?.organization ?? options.defaultLimitPerScope;
  }

  return options.defaultLimitPerScope;
}

function trimContextText(text: string, maxContextChars?: number): {
  contextText: string;
  truncated: boolean;
} {
  if (!maxContextChars || maxContextChars <= 0 || text.length <= maxContextChars) {
    return { contextText: text, truncated: false };
  }

  const trimmed = text.slice(0, Math.max(0, maxContextChars - 1)).trimEnd();
  return {
    contextText: `${trimmed}…`,
    truncated: true,
  };
}

function renderScopeHeading(label: MemoryScopeTarget['label']): string {
  if (label === 'conversation') return 'Conversation Memory';
  if (label === 'persona') return 'Persona Memory';
  if (label === 'user') return 'User Memory';
  return 'Organization Memory';
}

export function createStandaloneMemoryLongTermRetriever(
  memory: FeedbackCapableLongTermMemory,
  options?: StandaloneMemoryLongTermRetrieverOptions,
): ILongTermMemoryRetriever {
  const resolvedOptions: Required<StandaloneMemoryLongTermRetrieverOptions> = {
    defaultLimitPerScope: options?.defaultLimitPerScope ?? 4,
    conversationLimit: options?.conversationLimit ?? 4,
    includeScopeHeadings: options?.includeScopeHeadings ?? true,
  };

  return {
    async retrieveLongTermMemory(
      input: LongTermMemoryRetrievalInput,
    ): Promise<LongTermMemoryRetrievalResult | null> {
      const policy = input.memoryPolicy ?? DEFAULT_LONG_TERM_MEMORY_POLICY;
      const targets = resolveScopeTargets({
        userId: input.userId,
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        personaId: input.personaId,
        policy,
      });

      if (targets.length === 0) {
        return null;
      }

      const scopeResults: Array<{
        target: MemoryScopeTarget;
        hits: ScoredTrace[];
      }> = [];

      for (const target of targets) {
        const recallPolicy = input.retrievalPolicy ?? policy.retrieval ?? undefined;
        const recallOptions: RecallOptions = {
          limit: getScopeLimit(target, input, resolvedOptions),
          scope: target.memoryScope,
          scopeId: target.scopeId,
          policy: recallPolicy,
        };
        const hits = await memory.recall(input.queryText, recallOptions);
        if (hits.length > 0) {
          scopeResults.push({ target, hits });
        }
      }

      if (scopeResults.length === 0) {
        return null;
      }

      const seenContent = new Set<string>();
      const seenTraceIds = new Set<string>();
      const sections: string[] = [];
      const selectedTraces: MemoryTrace[] = [];
      const diagnostics: Record<string, unknown> = {
        totalHits: 0,
        queryText: input.queryText,
        scopes: {} as Record<string, number>,
      };

      for (const { target, hits } of scopeResults) {
        const lines: string[] = [];
        for (const hit of hits) {
          const content = normalizeText(hit.trace.content);
          if (!content) continue;
          if (seenContent.has(content)) continue;
          seenContent.add(content);
          if (!seenTraceIds.has(hit.trace.id)) {
            seenTraceIds.add(hit.trace.id);
            selectedTraces.push(hit.trace);
          }
          lines.push(`- ${content}`);
        }

        if (lines.length === 0) {
          continue;
        }

        (diagnostics.scopes as Record<string, number>)[target.label] = lines.length;
        diagnostics.totalHits = Number(diagnostics.totalHits) + lines.length;

        if (resolvedOptions.includeScopeHeadings) {
          sections.push(`### ${renderScopeHeading(target.label)}`);
        }
        sections.push(...lines);
      }

      if (sections.length === 0) {
        return null;
      }

      const rendered = sections.join('\n');
      const { contextText, truncated } = trimContextText(rendered, input.maxContextChars);
      diagnostics.truncated = truncated;

      return {
        contextText,
        diagnostics,
        feedbackPayload: selectedTraces.length > 0
          ? { traces: selectedTraces }
          : undefined,
      };
    },

    async recordRetrievalFeedback(
      input: LongTermMemoryFeedbackInput,
    ): Promise<void> {
      if (typeof memory.feedbackFromResponse !== 'function') {
        return;
      }

      const traces = Array.isArray((input.feedbackPayload as any)?.traces)
        ? ((input.feedbackPayload as any).traces as MemoryTrace[])
        : [];

      if (!input.responseText.trim() || traces.length === 0) {
        return;
      }

      await memory.feedbackFromResponse(traces, input.responseText, input.queryText);
    },
  };
}

function categoryAllowed(
  category: RollingSummaryMemoryCategory,
  allowedCategories: RollingSummaryMemoryCategory[] | null,
): boolean {
  if (allowedCategories === null) return true;
  return allowedCategories.includes(category);
}

function buildSummaryContent(update: RollingSummaryMemoryUpdate): string {
  return [
    `Rolling summary for conversation ${update.conversationId} (persona ${update.personaId}).`,
    update.summaryText.trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function collectSummaryEntities(summaryJson: any): string[] {
  const entities: string[] = [];
  if (!summaryJson || typeof summaryJson !== 'object') {
    return entities;
  }

  if (Array.isArray(summaryJson.people)) {
    for (const person of summaryJson.people) {
      const name = nonEmptyString(person?.name);
      if (name) entities.push(name);
    }
  }

  if (Array.isArray(summaryJson.projects)) {
    for (const project of summaryJson.projects) {
      const name = nonEmptyString(project?.name);
      if (name) entities.push(name);
    }
  }

  return unique(entities);
}

function extractAtomicDocs(
  summaryJson: any,
  allowedCategories: RollingSummaryMemoryCategory[] | null,
  baseTags: string[],
): AtomicDoc[] {
  if (!summaryJson || typeof summaryJson !== 'object') {
    return [];
  }

  const docs: AtomicDoc[] = [];

  const pushDoc = (
    category: RollingSummaryMemoryCategory,
    key: string,
    content: string | null,
    entities: string[] = [],
  ): void => {
    const normalized = normalizeText(content);
    if (!normalized || !categoryAllowed(category, allowedCategories)) {
      return;
    }
    docs.push({
      key: `${category}:${key}`,
      content: normalized,
      tags: [...baseTags, 'rolling_memory_item', `category:${category}`],
      entities: unique(entities),
    });
  };

  if (Array.isArray(summaryJson.facts)) {
    for (const item of summaryJson.facts) {
      const text = normalizeText(item?.text);
      pushDoc('facts', text ?? '', text ? `Fact: ${text}` : null);
    }
  }

  if (Array.isArray(summaryJson.preferences)) {
    for (const item of summaryJson.preferences) {
      const text = normalizeText(item?.text);
      pushDoc('preferences', text ?? '', text ? `Preference: ${text}` : null);
    }
  }

  if (Array.isArray(summaryJson.people)) {
    for (const person of summaryJson.people) {
      const formatted = formatPeopleEntry(person);
      pushDoc(
        'people',
        formatted?.content ?? '',
        formatted?.content ?? null,
        formatted?.entities ?? [],
      );
    }
  }

  if (Array.isArray(summaryJson.projects)) {
    for (const project of summaryJson.projects) {
      const formatted = formatProjectEntry(project);
      pushDoc(
        'projects',
        formatted?.content ?? '',
        formatted?.content ?? null,
        formatted?.entities ?? [],
      );
    }
  }

  if (Array.isArray(summaryJson.decisions)) {
    for (const item of summaryJson.decisions) {
      const text = normalizeText(item?.text);
      pushDoc('decisions', text ?? '', text ? `Decision: ${text}` : null);
    }
  }

  if (Array.isArray(summaryJson.open_loops)) {
    for (const item of summaryJson.open_loops) {
      const text = normalizeText(item?.text);
      pushDoc('open_loops', text ?? '', text ? `Open loop: ${text}` : null);
    }
  }

  if (Array.isArray(summaryJson.todo)) {
    for (const item of summaryJson.todo) {
      const text = normalizeText(item?.text);
      pushDoc('todo', text ?? '', text ? `Todo: ${text}` : null);
    }
  }

  if (Array.isArray(summaryJson.tags) && categoryAllowed('tags', allowedCategories)) {
    for (const tag of summaryJson.tags) {
      const normalized = normalizeText(tag);
      pushDoc('tags', normalized ?? '', normalized ? `Tag: ${normalized}` : null);
    }
  }

  return docs;
}

export function createStandaloneMemoryRollingSummarySink(
  memory: RuntimeStandaloneMemory,
  options?: StandaloneMemoryRollingSummarySinkOptions,
): IRollingSummaryMemorySink {
  const baseTags = unique(options?.baseTags ?? DEFAULT_BASE_TAGS);
  const summaryImportance = options?.summaryImportance ?? 0.9;
  const atomicDocImportance = options?.atomicDocImportance ?? 1.0;
  const summaryTraceIds = new Map<string, string>();
  const atomicTraceIds = new Map<string, Map<string, string>>();

  const upsertDocsForScope = async (
    target: MemoryScopeTarget,
    docs: AtomicDoc[],
  ): Promise<void> => {
    const next = new Map<string, string>();

    for (const doc of docs) {
      const trace = await memory.remember(doc.content, {
        type: 'semantic',
        scope: target.memoryScope,
        scopeId: target.scopeId,
        tags: doc.tags,
        entities: doc.entities,
        importance: atomicDocImportance,
      } satisfies RememberOptions);
      next.set(doc.key, trace.id);
    }

    const previous = atomicTraceIds.get(target.key);
    if (previous) {
      for (const [key, traceId] of previous.entries()) {
        if (next.get(key) !== traceId) {
          await memory.forget(traceId);
        }
      }
    }

    atomicTraceIds.set(target.key, next);
  };

  return {
    async upsertRollingSummaryMemory(update: RollingSummaryMemoryUpdate): Promise<void> {
      const policy = update.memoryPolicy ?? DEFAULT_LONG_TERM_MEMORY_POLICY;
      if (!policy.enabled) {
        return;
      }

      const targets = resolveScopeTargets({
        userId: update.userId,
        organizationId: update.organizationId,
        conversationId: update.conversationId,
        personaId: update.personaId,
        policy,
      });

      if (targets.length === 0) {
        return;
      }

      const summaryTags = unique([
        ...baseTags,
        'rolling_summary',
        ...(Array.isArray(update.summaryJson?.tags)
          ? (update.summaryJson.tags as unknown[])
              .map((tag: unknown): string | null => normalizeText(tag))
              .filter((tag): tag is string => Boolean(tag))
          : []),
      ]);
      const summaryEntities = collectSummaryEntities(update.summaryJson);
      const summaryContent = buildSummaryContent(update);
      const atomicDocs =
        policy.storeAtomicDocs === true
          ? extractAtomicDocs(update.summaryJson, policy.allowedCategories, baseTags)
          : [];

      for (const target of targets) {
        const summaryTrace = await memory.remember(summaryContent, {
          type: 'semantic',
          scope: target.memoryScope,
          scopeId: target.scopeId,
          tags: summaryTags,
          entities: summaryEntities,
          importance: summaryImportance,
        } satisfies RememberOptions);

        const previousSummaryTraceId = summaryTraceIds.get(target.key);
        if (
          previousSummaryTraceId &&
          previousSummaryTraceId !== summaryTrace.id
        ) {
          await memory.forget(previousSummaryTraceId);
        }
        summaryTraceIds.set(target.key, summaryTrace.id);

        await upsertDocsForScope(target, atomicDocs);
      }
    },
  };
}
