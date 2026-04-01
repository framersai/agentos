/**
 * HybridStrategy — Best-quality compaction using the full cognitive memory pipeline.
 *
 * Combines three approaches:
 * 1. MemoryObserver — personality-biased note extraction from conversation
 * 2. MemoryReflector — consolidation of notes into typed long-term traces
 * 3. Rolling summary — narrative continuity via SlidingSummaryStrategy
 *
 * Produces both a readable summary AND long-term memory traces, giving
 * the agent both narrative context and structured recall.
 */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
function generateId() {
    return `hybrid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
export class HybridStrategy {
    constructor(llmInvoker, observer, reflector) {
        this.name = 'hybrid';
        this.llmInvoker = llmInvoker;
        this.observer = observer;
        this.reflector = reflector;
    }
    async compact(input, config) {
        const startTime = Date.now();
        const { messages } = input;
        const preserveCount = Math.min(config.preserveRecentTurns * 2, messages.length - 2);
        const splitIdx = messages.length - preserveCount;
        if (splitIdx <= 0) {
            return this.noopResult(messages, startTime);
        }
        const toCompact = messages.slice(0, splitIdx);
        const toKeep = messages.slice(splitIdx);
        const inputTokens = toCompact.reduce((s, m) => s + m.tokenEstimate, 0);
        const turnRange = [
            toCompact[0].turnIndex,
            toCompact[toCompact.length - 1].turnIndex,
        ];
        // ── Phase 1: Extract observation notes via MemoryObserver ────────
        const observationNotes = [];
        if (this.observer) {
            // Feed all compactable messages through the observer.
            for (const msg of toCompact) {
                const notes = await this.observer.observe(msg.role, msg.content, input.emotionalContext
                    ? {
                        valence: input.emotionalContext.valence,
                        arousal: input.emotionalContext.arousal,
                        dominance: input.emotionalContext.dominance,
                    }
                    : undefined);
                if (notes)
                    observationNotes.push(...notes);
            }
            // Force-extract any remaining buffered content.
            const remaining = await this.observer.extractNotes(input.emotionalContext
                ? {
                    valence: input.emotionalContext.valence,
                    arousal: input.emotionalContext.arousal,
                    dominance: input.emotionalContext.dominance,
                }
                : undefined);
            if (remaining)
                observationNotes.push(...remaining);
        }
        // ── Phase 2: Consolidate notes into long-term traces via Reflector
        const tracesToEncode = [];
        if (this.reflector && observationNotes.length > 0) {
            // Feed notes to reflector.
            for (const note of observationNotes) {
                const result = await this.reflector.addNotes([note]);
                if (result) {
                    tracesToEncode.push(...result.traces);
                }
            }
            // Force reflect if notes remain.
            if (this.reflector.getPendingNoteCount() > 0) {
                const result = await this.reflector.reflect();
                if (result) {
                    tracesToEncode.push(...result.traces);
                }
            }
        }
        // ── Phase 3: Generate narrative summary (for prompt context) ─────
        const summary = await this.generateHybridSummary(toCompact, observationNotes, tracesToEncode, config);
        const outputTokens = estimateTokens(summary);
        // ── Assemble result ──────────────────────────────────────────────
        const summaryMessage = {
            role: 'system',
            content: [
                `[Hybrid compaction — turns ${turnRange[0]}–${turnRange[1]}]`,
                `[${inputTokens} tokens → ${outputTokens} tokens, ${observationNotes.length} observations, ${tracesToEncode.length} traces created]`,
                summary,
            ].join('\n'),
            timestamp: Date.now(),
            turnIndex: toCompact[0].turnIndex,
            tokenEstimate: outputTokens + 30,
            compacted: true,
        };
        const entryId = generateId();
        const entities = this.extractEntities(summary, observationNotes);
        const node = {
            id: `chain-${entryId}`,
            level: 0,
            turnRange,
            summary,
            tokenEstimate: outputTokens,
            createdAt: Date.now(),
            childIds: [],
            entities,
            compactionEntryId: entryId,
        };
        const entry = {
            id: entryId,
            timestamp: Date.now(),
            turnRange,
            strategy: 'hybrid',
            inputTokens,
            outputTokens,
            compressionRatio: outputTokens > 0
                ? Math.round((inputTokens / outputTokens) * 10) / 10
                : inputTokens,
            summary,
            droppedContent: [],
            preservedEntities: entities,
            tracesCreated: tracesToEncode
                .filter((t) => t.id)
                .map((t) => t.id),
            observationNotes,
            emotionalContext: input.emotionalContext,
            durationMs: Date.now() - startTime,
        };
        return {
            messages: [summaryMessage, ...toKeep],
            newNodes: [node],
            entry,
            tracesToEncode,
        };
    }
    // ── Summary generation ─────────────────────────────────────────────
    async generateHybridSummary(messages, notes, traces, config) {
        const conversationText = messages
            .map((m) => `[${m.role}] ${m.content}`)
            .join('\n');
        const inputTokens = estimateTokens(conversationText);
        const targetTokens = Math.max(120, Math.ceil(inputTokens / config.targetCompressionRatio));
        // Build context from extracted notes and traces.
        const notesSummary = notes.length > 0
            ? `\n\nExtracted observations (${notes.length}):\n${notes
                .slice(0, 15)
                .map((n) => `- [${n.type}] ${n.content} (importance: ${n.importance.toFixed(2)})`)
                .join('\n')}`
            : '';
        const tracesSummary = traces.length > 0
            ? `\n\nConsolidated memory traces (${traces.length}):\n${traces
                .slice(0, 10)
                .map((t) => `- [${t.type}/${t.scope}] ${t.content?.slice(0, 150)}`)
                .join('\n')}`
            : '';
        const prompt = [
            'Create a rich conversation summary that serves as context for an ongoing conversation.',
            'You have access to both the raw conversation AND extracted cognitive observations.',
            '',
            'Structure your summary as:',
            '1. **Key context**: What the conversation is about, who is involved',
            '2. **Decisions & outcomes**: What was decided, built, or resolved',
            '3. **Open threads**: Unresolved questions, pending work, next steps',
            '4. **Important details**: Technical specifics, file paths, configurations',
            '',
            `Target: ~${targetTokens} tokens.`,
            '',
            'Raw conversation:',
            conversationText,
            notesSummary,
            tracesSummary,
            '',
            'Summary:',
        ].join('\n');
        try {
            return (await this.llmInvoker(prompt)).trim();
        }
        catch {
            // Fallback: use observation notes as summary.
            if (notes.length > 0) {
                return notes
                    .sort((a, b) => b.importance - a.importance)
                    .slice(0, 10)
                    .map((n) => `[${n.type}] ${n.content}`)
                    .join('\n');
            }
            return `Conversation turns ${messages[0].turnIndex}–${messages[messages.length - 1].turnIndex}: ${messages
                .filter((m) => m.role === 'user')
                .slice(0, 3)
                .map((m) => m.content.slice(0, 100))
                .join('; ')}`;
        }
    }
    // ── Helpers ────────────────────────────────────────────────────────
    extractEntities(summary, notes) {
        const entities = new Set();
        // From summary text.
        const patterns = [
            /[\w/.-]+\.\w{1,5}/g,
            /https?:\/\/[^\s)]+/g,
            /`[^`]+`/g,
        ];
        for (const p of patterns) {
            const matches = summary.match(p);
            if (matches) {
                for (const m of matches)
                    entities.add(m.replace(/`/g, ''));
            }
        }
        // From observation notes.
        for (const note of notes) {
            if (note.entities) {
                for (const e of note.entities)
                    entities.add(e);
            }
        }
        return Array.from(entities).slice(0, 50);
    }
    noopResult(messages, startTime) {
        return {
            messages,
            newNodes: [],
            entry: {
                id: generateId(),
                timestamp: Date.now(),
                turnRange: [0, 0],
                strategy: 'hybrid',
                inputTokens: 0,
                outputTokens: 0,
                compressionRatio: 1,
                summary: '',
                droppedContent: [],
                preservedEntities: [],
                tracesCreated: [],
                durationMs: Date.now() - startTime,
            },
            tracesToEncode: [],
        };
    }
}
//# sourceMappingURL=HybridStrategy.js.map