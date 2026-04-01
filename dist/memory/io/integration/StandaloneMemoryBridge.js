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
import { DEFAULT_LONG_TERM_MEMORY_POLICY, } from '../../../core/conversation/LongTermMemoryPolicy.js';
const DEFAULT_BASE_TAGS = ['agentos', 'long_term_memory'];
const CATEGORY_ORDER = [
    'facts',
    'preferences',
    'people',
    'projects',
    'decisions',
    'open_loops',
    'todo',
    'tags',
];
function nonEmptyString(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
function normalizeText(value) {
    return nonEmptyString(value);
}
function formatPeopleEntry(person) {
    if (typeof person !== 'object' || person === null)
        return null;
    const name = nonEmptyString(person.name);
    const notes = nonEmptyString(person.notes);
    if (!name)
        return null;
    return {
        content: notes ? `Person: ${name}. ${notes}` : `Person: ${name}.`,
        entities: [name],
    };
}
function formatProjectEntry(project) {
    if (typeof project !== 'object' || project === null)
        return null;
    const name = nonEmptyString(project.name);
    const status = nonEmptyString(project.status);
    const notes = nonEmptyString(project.notes);
    if (!name)
        return null;
    const parts = [`Project: ${name}.`];
    if (status)
        parts.push(`Status: ${status}.`);
    if (notes)
        parts.push(notes);
    return {
        content: parts.join(' ').trim(),
        entities: [name],
    };
}
function unique(items) {
    return Array.from(new Set(items));
}
export function buildStandaloneMemoryPersonaScopeId(userId, personaId) {
    return `${userId}::${personaId}`;
}
function resolveScopeTargets(args) {
    const targets = [];
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
    if (policy.scopes.organization &&
        policy.shareWithOrganization &&
        organizationId) {
        targets.push({
            key: `organization:${organizationId}`,
            label: 'organization',
            memoryScope: 'organization',
            scopeId: organizationId,
        });
    }
    return targets;
}
function getScopeLimit(target, input, options) {
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
function trimContextText(text, maxContextChars) {
    if (!maxContextChars || maxContextChars <= 0 || text.length <= maxContextChars) {
        return { contextText: text, truncated: false };
    }
    const trimmed = text.slice(0, Math.max(0, maxContextChars - 1)).trimEnd();
    return {
        contextText: `${trimmed}…`,
        truncated: true,
    };
}
function renderScopeHeading(label) {
    if (label === 'conversation')
        return 'Conversation Memory';
    if (label === 'persona')
        return 'Persona Memory';
    if (label === 'user')
        return 'User Memory';
    return 'Organization Memory';
}
export function createStandaloneMemoryLongTermRetriever(memory, options) {
    const resolvedOptions = {
        defaultLimitPerScope: options?.defaultLimitPerScope ?? 4,
        conversationLimit: options?.conversationLimit ?? 4,
        includeScopeHeadings: options?.includeScopeHeadings ?? true,
    };
    return {
        async retrieveLongTermMemory(input) {
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
            const scopeResults = [];
            for (const target of targets) {
                const recallOptions = {
                    limit: getScopeLimit(target, input, resolvedOptions),
                    scope: target.memoryScope,
                    scopeId: target.scopeId,
                };
                const hits = await memory.recall(input.queryText, recallOptions);
                if (hits.length > 0) {
                    scopeResults.push({ target, hits });
                }
            }
            if (scopeResults.length === 0) {
                return null;
            }
            const seenContent = new Set();
            const seenTraceIds = new Set();
            const sections = [];
            const selectedTraces = [];
            const diagnostics = {
                totalHits: 0,
                queryText: input.queryText,
                scopes: {},
            };
            for (const { target, hits } of scopeResults) {
                const lines = [];
                for (const hit of hits) {
                    const content = normalizeText(hit.trace.content);
                    if (!content)
                        continue;
                    if (seenContent.has(content))
                        continue;
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
                diagnostics.scopes[target.label] = lines.length;
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
        async recordRetrievalFeedback(input) {
            if (typeof memory.feedbackFromResponse !== 'function') {
                return;
            }
            const traces = Array.isArray(input.feedbackPayload?.traces)
                ? input.feedbackPayload.traces
                : [];
            if (!input.responseText.trim() || traces.length === 0) {
                return;
            }
            await memory.feedbackFromResponse(traces, input.responseText, input.queryText);
        },
    };
}
function categoryAllowed(category, allowedCategories) {
    if (allowedCategories === null)
        return true;
    return allowedCategories.includes(category);
}
function buildSummaryContent(update) {
    return [
        `Rolling summary for conversation ${update.conversationId} (persona ${update.personaId}).`,
        update.summaryText.trim(),
    ]
        .filter(Boolean)
        .join('\n\n');
}
function collectSummaryEntities(summaryJson) {
    const entities = [];
    if (!summaryJson || typeof summaryJson !== 'object') {
        return entities;
    }
    if (Array.isArray(summaryJson.people)) {
        for (const person of summaryJson.people) {
            const name = nonEmptyString(person?.name);
            if (name)
                entities.push(name);
        }
    }
    if (Array.isArray(summaryJson.projects)) {
        for (const project of summaryJson.projects) {
            const name = nonEmptyString(project?.name);
            if (name)
                entities.push(name);
        }
    }
    return unique(entities);
}
function extractAtomicDocs(summaryJson, allowedCategories, baseTags) {
    if (!summaryJson || typeof summaryJson !== 'object') {
        return [];
    }
    const docs = [];
    const pushDoc = (category, key, content, entities = []) => {
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
            pushDoc('people', formatted?.content ?? '', formatted?.content ?? null, formatted?.entities ?? []);
        }
    }
    if (Array.isArray(summaryJson.projects)) {
        for (const project of summaryJson.projects) {
            const formatted = formatProjectEntry(project);
            pushDoc('projects', formatted?.content ?? '', formatted?.content ?? null, formatted?.entities ?? []);
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
export function createStandaloneMemoryRollingSummarySink(memory, options) {
    const baseTags = unique(options?.baseTags ?? DEFAULT_BASE_TAGS);
    const summaryImportance = options?.summaryImportance ?? 0.9;
    const atomicDocImportance = options?.atomicDocImportance ?? 1.0;
    const summaryTraceIds = new Map();
    const atomicTraceIds = new Map();
    const upsertDocsForScope = async (target, docs) => {
        const next = new Map();
        for (const doc of docs) {
            const trace = await memory.remember(doc.content, {
                type: 'semantic',
                scope: target.memoryScope,
                scopeId: target.scopeId,
                tags: doc.tags,
                entities: doc.entities,
                importance: atomicDocImportance,
            });
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
        async upsertRollingSummaryMemory(update) {
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
                    ? update.summaryJson.tags
                        .map((tag) => normalizeText(tag))
                        .filter((tag) => Boolean(tag))
                    : []),
            ]);
            const summaryEntities = collectSummaryEntities(update.summaryJson);
            const summaryContent = buildSummaryContent(update);
            const atomicDocs = policy.storeAtomicDocs === true
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
                });
                const previousSummaryTraceId = summaryTraceIds.get(target.key);
                if (previousSummaryTraceId &&
                    previousSummaryTraceId !== summaryTrace.id) {
                    await memory.forget(previousSummaryTraceId);
                }
                summaryTraceIds.set(target.key, summaryTrace.id);
                await upsertDocsForScope(target, atomicDocs);
            }
        },
    };
}
//# sourceMappingURL=StandaloneMemoryBridge.js.map