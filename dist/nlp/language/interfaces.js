/**
 * @file interfaces.ts
 * @description Core multilingual service contracts for AgentOS.
 * Defines provider-agnostic interfaces for language detection, translation,
 * and the high-level language orchestration service used throughout the runtime.
 *
 * The goal is to allow hosts to plug in any combination of third-party APIs
 * (e.g., OpenAI, DeepL, Azure Translator, Google Cloud Translation, custom ML models)
 * while retaining consistent negotiation, auditing, and fallback behavior.
 */
/** Utility to determine if a code block should be excluded from translation. */
export function isLikelyCodeBlock(snippet) {
    return /```[a-zA-Z0-9_-]*[\s\S]*?```/.test(snippet) || /class\s+\w+|function\s+\w+|=>/.test(snippet);
}
/** Simple heuristic partition for mixed content translation strategies. */
export function partitionCodeAndProse(content) {
    const codeBlocks = [];
    let prose = content;
    const codeRegex = /```[\s\S]*?```/g;
    const matches = content.match(codeRegex);
    if (matches) {
        matches.forEach(m => {
            codeBlocks.push(m);
            prose = prose.replace(m, `@@CODE_BLOCK_${codeBlocks.length - 1}@@`);
        });
    }
    return { codeBlocks, prose };
}
/** Recombine partitioned content after translating prose only. */
export function recombineCodeAndProse(translatedProse, codeBlocks) {
    let output = translatedProse;
    codeBlocks.forEach((block, idx) => {
        output = output.replace(`@@CODE_BLOCK_${idx}@@`, block);
    });
    return output;
}
//# sourceMappingURL=interfaces.js.map