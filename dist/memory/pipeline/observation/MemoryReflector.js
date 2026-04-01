/**
 * @fileoverview Memory Reflector — consolidates observation notes into long-term traces.
 *
 * Activates when accumulated observation notes exceed a token threshold.
 * Uses a persona-configured LLM to:
 * 1. Merge redundant observations
 * 2. Elevate important facts to long-term memory traces
 * 3. Detect conflicts against existing memories
 * 4. Resolve conflicts based on personality (high honesty → update, high agreeableness → coexist)
 *
 * Target compression: 5-40x (many observations → few traces).
 *
 * @module agentos/memory/observation/MemoryReflector
 */
// ---------------------------------------------------------------------------
// Personality-aware system prompt
// ---------------------------------------------------------------------------
function buildReflectorSystemPrompt(traits) {
    const clamp = (v) => v == null ? 0.5 : Math.max(0, Math.min(1, v));
    const conflictStrategy = clamp(traits.honesty) > 0.6
        ? 'When you detect a contradiction with existing knowledge, prefer the newer information and flag the old memory for supersession.'
        : clamp(traits.agreeableness) > 0.6
            ? 'When you detect a contradiction, keep both versions and note the discrepancy.'
            : 'When you detect a contradiction, keep the version with higher confidence.';
    const memoryStyle = clamp(traits.conscientiousness) > 0.6
        ? 'Produce structured, well-organized memory traces with clear categories.'
        : clamp(traits.openness) > 0.6
            ? 'Produce rich, associative memory traces that capture connections and context.'
            : 'Produce concise, factual memory traces focused on key information.';
    return `You are a memory reflector. Your job is to consolidate observation notes into long-term memory traces.

Rules:
1. Merge redundant or overlapping observations into single traces
2. Assign each trace a type: "episodic" (events), "semantic" (facts/knowledge), "procedural" (how-to), or "prospective" (future goals/intentions)
3. Assign a scope: "user" (about the user), "thread" (conversation-specific), "persona" (about the agent), or "organization" (shared)
4. ${conflictStrategy}
5. ${memoryStyle}
6. Target 5-40x compression: many notes → few high-quality traces

For each trace, output a JSON object on its own line:
{
  "type": "episodic|semantic|procedural|prospective",
  "scope": "user|thread|persona|organization",
  "scopeId": "relevant_id",
  "content": "consolidated memory content",
  "entities": ["entity1", "entity2"],
  "tags": ["tag1", "tag2"],
  "confidence": 0.0-1.0,
  "sourceType": "observation|reflection",
  "supersedes": ["existing_trace_id_if_contradicted"],
  "consumedNotes": ["note_id1", "note_id2"]
}

Output ONLY valid JSON objects, one per line.`;
}
// ---------------------------------------------------------------------------
// MemoryReflector
// ---------------------------------------------------------------------------
export class MemoryReflector {
    constructor(traits, config) {
        this.pendingNotes = [];
        this.traits = traits;
        this.config = {
            activationThresholdTokens: config?.activationThresholdTokens ?? 40000,
            modelId: config?.modelId,
            llmInvoker: config?.llmInvoker,
        };
        this.llmInvoker = config?.llmInvoker;
    }
    /**
     * Add observation notes for future reflection.
     * Returns a MemoryReflectionResult if the note threshold is reached.
     */
    async addNotes(notes) {
        this.pendingNotes.push(...notes);
        if (!this.shouldActivate())
            return null;
        if (!this.llmInvoker)
            return null;
        return this.reflect();
    }
    /** Whether accumulated notes exceed the reflection threshold. */
    shouldActivate() {
        const totalTokens = this.pendingNotes.reduce((sum, note) => sum + Math.ceil(note.content.length / 4), 0);
        return totalTokens >= this.config.activationThresholdTokens;
    }
    /**
     * Force reflection over all pending notes.
     */
    async reflect(existingMemoryContext) {
        if (!this.llmInvoker || this.pendingNotes.length === 0) {
            return { traces: [], supersededTraceIds: [], consumedNoteIds: [], compressionRatio: 1 };
        }
        const notesText = this.pendingNotes
            .map((n) => `[${n.id}] (${n.type}, importance=${n.importance.toFixed(2)}) ${n.content}`)
            .join('\n');
        const userPrompt = existingMemoryContext
            ? `## Existing Memory Context\n${existingMemoryContext}\n\n## New Observation Notes\n${notesText}`
            : `## Observation Notes\n${notesText}`;
        const systemPrompt = buildReflectorSystemPrompt(this.traits);
        try {
            const response = await this.llmInvoker(systemPrompt, userPrompt);
            const result = this.parseReflection(response);
            // Clear consumed notes
            const consumedSet = new Set(result.consumedNoteIds);
            this.pendingNotes = this.pendingNotes.filter((n) => !consumedSet.has(n.id));
            // Compute compression ratio
            const inputTokens = notesText.length / 4;
            const outputTokens = result.traces.reduce((sum, t) => sum + t.content.length / 4, 0);
            result.compressionRatio = outputTokens > 0 ? inputTokens / outputTokens : 1;
            return result;
        }
        catch {
            return { traces: [], supersededTraceIds: [], consumedNoteIds: [], compressionRatio: 1 };
        }
    }
    /** Get pending note count. */
    getPendingNoteCount() {
        return this.pendingNotes.length;
    }
    /** Clear all pending notes. */
    clear() {
        this.pendingNotes = [];
    }
    // --- Internal ---
    parseReflection(llmResponse) {
        const traces = [];
        const supersededTraceIds = [];
        const consumedNoteIds = [];
        const lines = llmResponse.split('\n').filter((l) => l.trim());
        const now = Date.now();
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line.trim());
                if (!parsed.content)
                    continue;
                const type = (['episodic', 'semantic', 'procedural', 'prospective', 'relational'].includes(parsed.type)
                    ? parsed.type
                    : 'semantic');
                const scope = (['user', 'thread', 'persona', 'organization'].includes(parsed.scope)
                    ? parsed.scope
                    : 'user');
                traces.push({
                    type,
                    scope,
                    scopeId: parsed.scopeId ?? '',
                    content: parsed.content,
                    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
                    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
                    provenance: {
                        sourceType: 'reflection',
                        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
                        verificationCount: 0,
                        sourceTimestamp: now,
                    },
                    emotionalContext: {
                        valence: 0,
                        arousal: 0,
                        dominance: 0,
                        intensity: 0,
                        gmiMood: '',
                    },
                    associatedTraceIds: [],
                    isActive: true,
                });
                if (Array.isArray(parsed.supersedes)) {
                    supersededTraceIds.push(...parsed.supersedes);
                }
                if (Array.isArray(parsed.consumedNotes)) {
                    consumedNoteIds.push(...parsed.consumedNotes);
                }
            }
            catch {
                // Skip malformed lines
            }
        }
        // If no specific notes were claimed, consider all pending consumed
        if (consumedNoteIds.length === 0 && traces.length > 0) {
            consumedNoteIds.push(...this.pendingNotes.map((n) => n.id));
        }
        return { traces, supersededTraceIds, consumedNoteIds, compressionRatio: 1 };
    }
}
//# sourceMappingURL=MemoryReflector.js.map