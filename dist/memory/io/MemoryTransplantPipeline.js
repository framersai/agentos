/**
 * @fileoverview Identity-aware memory transplant pipeline.
 *
 * Sits between JsonExporter output and JsonImporter input. Classifies each
 * trace as player-fact, shared-experience, self-referential, or world-knowledge,
 * then filters and rewrites accordingly for cross-entity memory transfer.
 *
 * @module memory/io/MemoryTransplantPipeline
 */
// ---------------------------------------------------------------------------
// Classification patterns
// ---------------------------------------------------------------------------
const SELF_REFERENTIAL_PATTERNS = [
    /^\[assistant\]/i,
    /\bI am\b/i,
    /\bmy name is\b/i,
    /\bI was born\b/i,
    /\bI grew up\b/i,
    /\bI have always been\b/i,
    /\bI believe I\b/i,
];
const PLAYER_FACT_PATTERNS = [
    /\b(?:the\s|this\s)?(?:player|user|human)\b/i,
    /\bthey\s+(?:like|prefer|hate|are|have|want|need|enjoy|dislike)\b/i,
    /\bthe player's\b/i,
    /\buser prefers\b/i,
];
const SHARED_EXPERIENCE_PATTERNS = [
    /\bwe\s+(?:discussed|talked|went|shared|argued|played|fought|explored|discovered)\b/i,
    /\btogether\b/i,
    /\bour\s+(?:conversation|adventure|time|journey|discussion)\b/i,
    /\b(?:told|showed|asked|gave|helped)\s+(?:me|you)\b/i,
];
// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------
function classifyTrace(trace, sourceIdentity) {
    const content = trace.content;
    const type = trace.type ?? 'episodic';
    if (SELF_REFERENTIAL_PATTERNS.some((p) => p.test(content))) {
        return 'self_referential';
    }
    if (sourceIdentity?.name) {
        const nameRegex = new RegExp(`\\b${escapeRegex(sourceIdentity.name)}\\b`, 'i');
        if (nameRegex.test(content) && /\bI\b|\bmy\b|\bme\b/i.test(content)) {
            return 'self_referential';
        }
    }
    try {
        const tags = JSON.parse(trace.tags ?? '[]');
        if (tags.includes('role:assistant') && /\bI\b/i.test(content) && !PLAYER_FACT_PATTERNS.some((p) => p.test(content))) {
            return 'self_referential';
        }
    }
    catch { /* ignore malformed tags */ }
    if (PLAYER_FACT_PATTERNS.some((p) => p.test(content))) {
        return 'player_fact';
    }
    if (SHARED_EXPERIENCE_PATTERNS.some((p) => p.test(content))) {
        return 'shared_experience';
    }
    if (type === 'semantic') {
        return 'world_knowledge';
    }
    return 'player_fact';
}
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// ---------------------------------------------------------------------------
// Heuristic rewrite
// ---------------------------------------------------------------------------
function rewriteSharedExperience(content) {
    let result = content;
    result = result.replace(/^\[(?:assistant|user)\]\s*/i, '');
    result = result.replace(/\bI told you about\b/gi, 'The player heard about');
    result = result.replace(/\bI (?:told|asked|showed) (?:you|the player)\b/gi, 'The player was told');
    result = result.replace(/\bYou (?:told|showed|asked) me\b/gi, 'The player');
    result = result.replace(/\bWe discussed\b/gi, 'The player discussed');
    result = result.replace(/\bWe talked about\b/gi, 'The player talked about');
    result = result.replace(/\bWe argued about\b/gi, 'The player argued about');
    result = result.replace(/\bWe went\b/gi, 'The player went');
    result = result.replace(/\bWe shared\b/gi, 'The player shared');
    result = result.replace(/\bWe explored\b/gi, 'The player explored');
    result = result.replace(/\bWe discovered\b/gi, 'The player discovered');
    result = result.replace(/\btogether\b/gi, '');
    result = result.replace(/\s{2,}/g, ' ').trim();
    return result;
}
// ---------------------------------------------------------------------------
// LLM rewrite
// ---------------------------------------------------------------------------
const LLM_SYSTEM_PROMPT = `You are a memory depersonalization agent. Given a memory trace from a companion character, rewrite it to be identity-neutral. Remove references to the companion's identity, speech patterns, and self-descriptions. Preserve all factual information about the player and shared events. Convert companion first-person references to player-centric third person. Output only the rewritten text, nothing else.`;
async function rewriteWithLlm(content, sourceIdentity, llmInvoker) {
    const systemPrompt = `${LLM_SYSTEM_PROMPT}\n\nSource companion name: "${sourceIdentity.name}"`;
    try {
        const result = await llmInvoker(systemPrompt, content);
        return result.trim() || content;
    }
    catch {
        return rewriteSharedExperience(content);
    }
}
// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
function addTransplantTags(trace, sourceIdentity) {
    let tags = [];
    try {
        tags = JSON.parse(trace.tags ?? '[]');
    }
    catch { /* ignore */ }
    tags.push('origin:transplant');
    if (sourceIdentity?.name) {
        tags.push(`source:companion-${sourceIdentity.name}`);
    }
    tags.push(`transplanted_at:${new Date().toISOString()}`);
    trace.tags = JSON.stringify(tags);
}
export class MemoryTransplantPipeline {
    /**
     * Transform a brain JSON payload for cross-entity memory transfer.
     *
     * Classifies each trace, filters self-referential ones, rewrites shared
     * experiences, and re-tags survivors with transplant provenance.
     */
    static async transform(brainJson, options) {
        const result = {
            transformedJson: '',
            transferred: 0,
            filtered: 0,
            rewritten: 0,
            errors: [],
        };
        let payload;
        try {
            payload = JSON.parse(brainJson);
        }
        catch (err) {
            result.errors.push(`Invalid JSON: ${String(err)}`);
            result.transformedJson = brainJson;
            return result;
        }
        const traces = (payload.traces ?? []);
        const outputTraces = [];
        for (const trace of traces) {
            if (!trace.content || trace.deleted === 1) {
                outputTraces.push(trace);
                continue;
            }
            const category = classifyTrace(trace, options.sourceIdentity);
            switch (category) {
                case 'self_referential':
                    result.filtered++;
                    break;
                case 'shared_experience': {
                    let rewritten;
                    if (options.mode === 'llm' && options.llmInvoker && options.sourceIdentity) {
                        rewritten = await rewriteWithLlm(trace.content, options.sourceIdentity, options.llmInvoker);
                    }
                    else {
                        rewritten = rewriteSharedExperience(trace.content);
                    }
                    const rewrittenTrace = { ...trace, content: rewritten };
                    addTransplantTags(rewrittenTrace, options.sourceIdentity);
                    outputTraces.push(rewrittenTrace);
                    result.rewritten++;
                    result.transferred++;
                    break;
                }
                case 'player_fact':
                case 'world_knowledge':
                default: {
                    const passedTrace = { ...trace };
                    addTransplantTags(passedTrace, options.sourceIdentity);
                    outputTraces.push(passedTrace);
                    result.transferred++;
                    break;
                }
            }
        }
        payload.traces = outputTraces;
        result.transformedJson = JSON.stringify(payload);
        return result;
    }
}
//# sourceMappingURL=MemoryTransplantPipeline.js.map