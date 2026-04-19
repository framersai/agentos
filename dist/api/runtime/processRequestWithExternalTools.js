import { isActionableToolCallRequestChunk, } from '../types/AgentOSResponse.js';
import { AgentOSServiceError } from '../errors.js';
import { GMIErrorCode } from '@framers/agentos/core/utils/errors';
async function* continueStreamWithExternalTools(agentos, stream, executeToolCall) {
    for await (const chunk of stream) {
        yield chunk;
        if (!isActionableToolCallRequestChunk(chunk)) {
            continue;
        }
        const toolResults = [];
        for (const toolCall of chunk.toolCalls) {
            const execution = await executeToolCall({
                agentos,
                streamId: chunk.streamId,
                requestChunk: chunk,
                toolCall,
            });
            toolResults.push({
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                toolOutput: execution.toolOutput,
                isSuccess: execution.isSuccess ?? true,
                errorMessage: execution.errorMessage,
            });
        }
        if (toolResults.length > 1 && !agentos.handleToolResults) {
            throw new AgentOSServiceError(`processRequestWithExternalTools received ${toolResults.length} actionable external tool calls, but the provided AgentOS runtime does not support batched continuation.`, GMIErrorCode.INVALID_STATE, {
                streamId: chunk.streamId,
                toolCallCount: chunk.toolCalls.length,
                toolCalls: chunk.toolCalls.map((toolCall) => ({
                    id: toolCall.id,
                    name: toolCall.name,
                })),
            }, 'processRequestWithExternalTools');
        }
        yield* continueStreamWithExternalTools(agentos, toolResults.length === 1 || !agentos.handleToolResults
            ? agentos.handleToolResult(chunk.streamId, toolResults[0].toolCallId, toolResults[0].toolName, toolResults[0].toolOutput, toolResults[0].isSuccess, toolResults[0].errorMessage)
            : agentos.handleToolResults(chunk.streamId, toolResults), executeToolCall);
    }
}
/**
 * Runs a full `AgentOS.processRequest(...)` turn and automatically resumes any
 * actionable external tool pauses through `handleToolResult(...)`.
 *
 * Actionable external tool calls are executed in emitted order. When a pause
 * contains multiple actionable tool calls, the helper batches their results and
 * resumes the stream once through `handleToolResults(...)` when available.
 */
export async function* processRequestWithExternalTools(agentos, input, executeToolCall) {
    yield* continueStreamWithExternalTools(agentos, agentos.processRequest(input), executeToolCall);
}
//# sourceMappingURL=processRequestWithExternalTools.js.map