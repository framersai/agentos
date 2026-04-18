import { parseToolCallsFromText } from './TextToolCallParser.js';
export function buildSyntheticToolCallsFromText(text, step) {
    return parseToolCallsFromText(text).map((toolCall, index) => ({
        id: `text-tc-${step}-${index}`,
        type: 'function',
        function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
        },
    }));
}
export function resolveDynamicToolCalls(toolCalls, options) {
    if (toolCalls && toolCalls.length > 0) {
        return [...toolCalls];
    }
    if (!options.toolsAvailable || !options.text) {
        return [];
    }
    return buildSyntheticToolCallsFromText(options.text, options.step);
}
//# sourceMappingURL=dynamicToolCalling.js.map