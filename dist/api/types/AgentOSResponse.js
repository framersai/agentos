// File: backend/agentos/api/types/AgentOSResponse.ts
/**
 * @fileoverview Defines the unified streaming output structure for the AgentOS API.
 * This interface allows for real-time delivery of text deltas, tool call requests,
 * system progress, and final comprehensive responses from the AgentOS.
 * @module backend/agentos/api/types/AgentOSResponse
 */
/**
 * @enum {string} AgentOSResponseChunkType
 * Defines the distinct types of chunks that can be streamed from the AgentOS.
 */
export var AgentOSResponseChunkType;
(function (AgentOSResponseChunkType) {
    AgentOSResponseChunkType["TEXT_DELTA"] = "text_delta";
    AgentOSResponseChunkType["SYSTEM_PROGRESS"] = "system_progress";
    AgentOSResponseChunkType["TOOL_CALL_REQUEST"] = "tool_call_request";
    AgentOSResponseChunkType["TOOL_RESULT_EMISSION"] = "tool_result_emission";
    AgentOSResponseChunkType["UI_COMMAND"] = "ui_command";
    AgentOSResponseChunkType["FINAL_RESPONSE"] = "final_response";
    AgentOSResponseChunkType["ERROR"] = "error";
    AgentOSResponseChunkType["METADATA_UPDATE"] = "metadata_update";
    AgentOSResponseChunkType["WORKFLOW_UPDATE"] = "workflow_update";
    AgentOSResponseChunkType["AGENCY_UPDATE"] = "agency_update";
    AgentOSResponseChunkType["PROVENANCE_EVENT"] = "provenance_event";
})(AgentOSResponseChunkType || (AgentOSResponseChunkType = {}));
function isChunkRecord(value) {
    return value !== null && typeof value === 'object';
}
/**
 * Runtime type guard for streamed tool-call request chunks.
 */
export function isToolCallRequestChunk(chunk) {
    return (isChunkRecord(chunk) &&
        chunk.type === AgentOSResponseChunkType.TOOL_CALL_REQUEST &&
        Array.isArray(chunk.toolCalls));
}
/**
 * Runtime type guard for tool-call request chunks that require the host to
 * call `handleToolResult(...)` to continue the turn.
 */
export function isActionableToolCallRequestChunk(chunk) {
    return (isToolCallRequestChunk(chunk) &&
        chunk.executionMode === 'external' &&
        chunk.requiresExternalToolResult === true);
}
//# sourceMappingURL=AgentOSResponse.js.map