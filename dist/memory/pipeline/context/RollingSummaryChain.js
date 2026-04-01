/**
 * RollingSummaryChain — Linked chain of conversation summaries.
 *
 * Each compaction produces a summary node. When the chain itself exceeds
 * its token budget, older nodes are re-summarized into higher-level nodes
 * (summary-of-summaries), forming a tree structure:
 *
 *   [L2: turns 1-300]
 *     ├── [L1: turns 1-120]
 *     │     ├── [L0: turns 1-50]
 *     │     └── [L0: turns 51-120]
 *     └── [L1: turns 121-300]
 *           ├── [L0: turns 121-200]
 *           └── [L0: turns 201-300]
 *
 * The chain head (highest-level summary covering all compacted turns)
 * is always included in the prompt as "conversation so far".
 */
/** Approximate tokens from character count (~4 chars/token). */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
export class RollingSummaryChain {
    constructor(maxBudgetTokens = 2000, llmInvoker) {
        this.nodes = new Map();
        this.maxBudgetTokens = maxBudgetTokens;
        this.llmInvoker = llmInvoker;
    }
    // ── Write ──────────────────────────────────────────────────────────
    /** Add new leaf nodes from a compaction. */
    addNodes(nodes) {
        for (const node of nodes) {
            this.nodes.set(node.id, node);
        }
    }
    /**
     * Collapse the chain if it exceeds the token budget.
     * Merges the oldest leaf nodes into a higher-level summary.
     * Returns any newly created parent nodes.
     */
    async collapse() {
        const created = [];
        // Keep collapsing while over budget.
        while (this.getTotalTokens() > this.maxBudgetTokens) {
            const leaves = this.getActiveLeaves();
            if (leaves.length <= 1)
                break; // can't compress further
            // Take the 2-4 oldest leaves to merge.
            const toMerge = leaves.slice(0, Math.min(4, leaves.length));
            const parent = await this.mergeNodes(toMerge);
            if (!parent)
                break; // LLM not available, stop
            // Mark children as absorbed.
            for (const child of toMerge) {
                const node = this.nodes.get(child.id);
                if (node)
                    node.parentId = parent.id;
            }
            this.nodes.set(parent.id, parent);
            created.push(parent);
        }
        return created;
    }
    // ── Read ───────────────────────────────────────────────────────────
    /** Get the active chain — top-level nodes without parents, sorted by turn range. */
    getActiveChain() {
        return this.getActiveLeaves();
    }
    /** Format the chain for inclusion in a prompt. */
    formatForPrompt() {
        const chain = this.getActiveChain();
        if (chain.length === 0)
            return '';
        const totalTurnRange = [
            chain[0].turnRange[0],
            chain[chain.length - 1].turnRange[1],
        ];
        const parts = [
            `[Conversation history — turns ${totalTurnRange[0]}–${totalTurnRange[1]}, compressed]`,
        ];
        for (const node of chain) {
            if (chain.length > 1) {
                parts.push(`--- Turns ${node.turnRange[0]}–${node.turnRange[1]} ---`);
            }
            parts.push(node.summary);
        }
        return parts.join('\n');
    }
    /** Total tokens across all active (non-absorbed) nodes. */
    getTotalTokens() {
        return this.getActiveLeaves().reduce((sum, n) => sum + n.tokenEstimate, 0);
    }
    /** Get all nodes (including absorbed children, for audit/UI). */
    getAllNodes() {
        return Array.from(this.nodes.values()).sort((a, b) => a.turnRange[0] - b.turnRange[0]);
    }
    /** Get the full turn range covered by the chain. */
    getCoveredRange() {
        const chain = this.getActiveChain();
        if (chain.length === 0)
            return null;
        return [chain[0].turnRange[0], chain[chain.length - 1].turnRange[1]];
    }
    get size() {
        return this.nodes.size;
    }
    // ── Internal ───────────────────────────────────────────────────────
    /** Active leaves = nodes without a parent, sorted by turn range. */
    getActiveLeaves() {
        return Array.from(this.nodes.values())
            .filter((n) => !n.parentId)
            .sort((a, b) => a.turnRange[0] - b.turnRange[0]);
    }
    /** Merge multiple nodes into a single higher-level summary. */
    async mergeNodes(nodes) {
        if (!this.llmInvoker) {
            // No LLM — fall back to simple concatenation with truncation.
            return this.fallbackMerge(nodes);
        }
        const combinedText = nodes.map((n) => n.summary).join('\n\n');
        const turnRange = [
            nodes[0].turnRange[0],
            nodes[nodes.length - 1].turnRange[1],
        ];
        const prompt = [
            'You are a conversation summarizer. Merge the following conversation summaries into a single, more concise summary.',
            'Preserve all key decisions, action items, named entities, and important context.',
            'Drop redundant details and transitional language.',
            `Target: approximately ${Math.ceil(combinedText.length / 4 / 3)} tokens (3:1 compression of input).`,
            '',
            `These summaries cover turns ${turnRange[0]}–${turnRange[1]}:`,
            '',
            combinedText,
            '',
            'Produce ONLY the merged summary, no preamble:',
        ].join('\n');
        try {
            const summary = await this.llmInvoker(prompt);
            const allEntities = new Set();
            for (const n of nodes) {
                for (const e of n.entities)
                    allEntities.add(e);
            }
            return {
                id: `chain-${Date.now()}-L${(nodes[0].level || 0) + 1}`,
                level: (nodes[0].level || 0) + 1,
                turnRange,
                summary: summary.trim(),
                tokenEstimate: estimateTokens(summary),
                createdAt: Date.now(),
                childIds: nodes.map((n) => n.id),
                entities: Array.from(allEntities),
                compactionEntryId: nodes[0].compactionEntryId,
            };
        }
        catch {
            return this.fallbackMerge(nodes);
        }
    }
    /** Non-LLM fallback: concatenate and truncate to budget. */
    fallbackMerge(nodes) {
        const combined = nodes.map((n) => n.summary).join(' ');
        // Truncate to roughly half the budget.
        const targetChars = (this.maxBudgetTokens / 2) * 4;
        const truncated = combined.length > targetChars
            ? combined.slice(0, targetChars) + '...'
            : combined;
        const allEntities = new Set();
        for (const n of nodes) {
            for (const e of n.entities)
                allEntities.add(e);
        }
        return {
            id: `chain-${Date.now()}-L${(nodes[0].level || 0) + 1}`,
            level: (nodes[0].level || 0) + 1,
            turnRange: [
                nodes[0].turnRange[0],
                nodes[nodes.length - 1].turnRange[1],
            ],
            summary: truncated,
            tokenEstimate: estimateTokens(truncated),
            createdAt: Date.now(),
            childIds: nodes.map((n) => n.id),
            entities: Array.from(allEntities),
            compactionEntryId: nodes[0].compactionEntryId,
        };
    }
    /** Reset the chain. */
    clear() {
        this.nodes.clear();
    }
}
//# sourceMappingURL=RollingSummaryChain.js.map