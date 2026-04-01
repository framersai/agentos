/**
 * HierarchicalStrategy — Multi-level summary tree for very long conversations.
 *
 * Maintains 4 levels of compression:
 *   L0: Raw messages (last N turns)
 *   L1: Per-segment summaries (~50 turns each)
 *   L2: Per-session summaries (merges L1 nodes)
 *   L3: Overall conversation summary (single node)
 *
 * Each level compresses ~5-10x, giving total compression of up to 1000x
 * for multi-day conversations.
 */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
function generateId(level) {
    return `hier-L${level}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
/** Maximum L1 nodes before triggering L2 merge. */
const MAX_L1_NODES = 5;
/** Maximum L2 nodes before triggering L3 merge. */
const MAX_L2_NODES = 3;
export class HierarchicalStrategy {
    constructor(llmInvoker) {
        this.name = 'hierarchical';
        this.llmInvoker = llmInvoker;
    }
    async compact(input, config) {
        const startTime = Date.now();
        const { messages, summaryChain } = input;
        // Preserve recent turns.
        const preserveCount = Math.min(config.preserveRecentTurns * 2, messages.length - 2);
        const splitIdx = messages.length - preserveCount;
        if (splitIdx <= 0) {
            return this.noopResult(messages, startTime);
        }
        const toCompact = messages.slice(0, splitIdx);
        const toKeep = messages.slice(splitIdx);
        const inputTokens = toCompact.reduce((s, m) => s + m.tokenEstimate, 0);
        // Step 1: Create L0 summary of the compacted segment.
        const l0Node = await this.createL0Summary(toCompact, config);
        const allNewNodes = [l0Node];
        // Step 2: Check if we need L1 merge (too many L0 nodes).
        const existingL0 = summaryChain.filter((n) => n.level === 0 && !n.parentId);
        const allL0 = [...existingL0, l0Node];
        if (allL0.length > MAX_L1_NODES) {
            const l1Node = await this.mergeLevel(allL0, 1, config);
            if (l1Node) {
                for (const child of allL0)
                    child.parentId = l1Node.id;
                allNewNodes.push(l1Node);
                // Step 3: Check if we need L2 merge.
                const existingL1 = summaryChain.filter((n) => n.level === 1 && !n.parentId);
                const allL1 = [...existingL1, l1Node];
                if (allL1.length > MAX_L2_NODES) {
                    const l2Node = await this.mergeLevel(allL1, 2, config);
                    if (l2Node) {
                        for (const child of allL1)
                            child.parentId = l2Node.id;
                        allNewNodes.push(l2Node);
                    }
                }
            }
        }
        // Build summary message for prompt injection.
        const activeNodes = [...summaryChain, ...allNewNodes].filter((n) => !n.parentId);
        const summaryText = activeNodes
            .sort((a, b) => a.turnRange[0] - b.turnRange[0])
            .map((n) => {
            const levelTag = n.level > 0 ? ` (L${n.level} summary)` : '';
            return `[Turns ${n.turnRange[0]}–${n.turnRange[1]}${levelTag}]\n${n.summary}`;
        })
            .join('\n\n');
        const outputTokens = estimateTokens(summaryText);
        const summaryMessage = {
            role: 'system',
            content: `[Hierarchical conversation history — ${inputTokens} tokens → ${outputTokens} tokens]\n${summaryText}`,
            timestamp: Date.now(),
            turnIndex: toCompact[0].turnIndex,
            tokenEstimate: outputTokens + 20,
            compacted: true,
        };
        const entryId = generateId(0);
        const turnRange = [
            toCompact[0].turnIndex,
            toCompact[toCompact.length - 1].turnIndex,
        ];
        const entry = {
            id: entryId,
            timestamp: Date.now(),
            turnRange,
            strategy: 'hierarchical',
            inputTokens,
            outputTokens,
            compressionRatio: outputTokens > 0
                ? Math.round((inputTokens / outputTokens) * 10) / 10
                : inputTokens,
            summary: summaryText,
            droppedContent: [],
            preservedEntities: this.collectEntities(allNewNodes),
            tracesCreated: [],
            emotionalContext: input.emotionalContext,
            durationMs: Date.now() - startTime,
        };
        return {
            messages: [summaryMessage, ...toKeep],
            newNodes: allNewNodes,
            entry,
            tracesToEncode: [],
        };
    }
    // ── Level summaries ────────────────────────────────────────────────
    async createL0Summary(messages, config) {
        const text = messages.map((m) => `[${m.role}] ${m.content}`).join('\n');
        const targetTokens = Math.max(80, Math.ceil(estimateTokens(text) / config.targetCompressionRatio));
        const turnRange = [
            messages[0].turnIndex,
            messages[messages.length - 1].turnIndex,
        ];
        const prompt = [
            'Summarize this conversation segment. Preserve decisions, action items, entities, technical details, and open questions.',
            `Target: ~${targetTokens} tokens.`,
            '',
            `Turns ${turnRange[0]}–${turnRange[1]}:`,
            text,
            '',
            'Summary:',
        ].join('\n');
        let summary;
        try {
            summary = (await this.llmInvoker(prompt)).trim();
        }
        catch {
            summary = `Conversation turns ${turnRange[0]}–${turnRange[1]}: ${messages
                .filter((m) => m.role === 'user')
                .map((m) => m.content.slice(0, 80))
                .join('; ')}`;
        }
        return {
            id: generateId(0),
            level: 0,
            turnRange,
            summary,
            tokenEstimate: estimateTokens(summary),
            createdAt: Date.now(),
            childIds: [],
            entities: this.extractEntitiesFromText(summary),
            compactionEntryId: '',
        };
    }
    async mergeLevel(nodes, targetLevel, config) {
        const combined = nodes
            .map((n) => `[Turns ${n.turnRange[0]}–${n.turnRange[1]}]\n${n.summary}`)
            .join('\n\n');
        const targetTokens = Math.max(60, Math.ceil(estimateTokens(combined) / (config.targetCompressionRatio / 2)));
        const turnRange = [
            nodes[0].turnRange[0],
            nodes[nodes.length - 1].turnRange[1],
        ];
        const prompt = [
            `Merge these L${targetLevel - 1} conversation summaries into a single higher-level summary.`,
            'Preserve the most important decisions, outcomes, and ongoing threads.',
            'Consolidate redundant information.',
            `Target: ~${targetTokens} tokens.`,
            '',
            combined,
            '',
            'Merged summary:',
        ].join('\n');
        try {
            const summary = (await this.llmInvoker(prompt)).trim();
            const allEntities = new Set();
            for (const n of nodes) {
                for (const e of n.entities)
                    allEntities.add(e);
            }
            return {
                id: generateId(targetLevel),
                level: targetLevel,
                turnRange,
                summary,
                tokenEstimate: estimateTokens(summary),
                createdAt: Date.now(),
                childIds: nodes.map((n) => n.id),
                entities: Array.from(allEntities),
                compactionEntryId: '',
            };
        }
        catch {
            return null;
        }
    }
    // ── Helpers ────────────────────────────────────────────────────────
    extractEntitiesFromText(text) {
        const entities = new Set();
        const patterns = [
            /[\w/.-]+\.\w{1,5}/g, // file paths
            /https?:\/\/[^\s)]+/g, // URLs
            /`[^`]+`/g, // code identifiers
        ];
        for (const p of patterns) {
            const matches = text.match(p);
            if (matches) {
                for (const m of matches)
                    entities.add(m.replace(/`/g, ''));
            }
        }
        return Array.from(entities).slice(0, 30);
    }
    collectEntities(nodes) {
        const all = new Set();
        for (const n of nodes) {
            for (const e of n.entities)
                all.add(e);
        }
        return Array.from(all);
    }
    noopResult(messages, startTime) {
        return {
            messages,
            newNodes: [],
            entry: {
                id: generateId(0),
                timestamp: Date.now(),
                turnRange: [0, 0],
                strategy: 'hierarchical',
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
//# sourceMappingURL=HierarchicalStrategy.js.map