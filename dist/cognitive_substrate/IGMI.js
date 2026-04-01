// File: backend/agentos/cognitive_substrate/IGMI.ts
/**
 * @fileoverview Defines the core interface (IGMI) for a Generalized Mind Instance,
 * its configuration, inputs, outputs, states, and related data structures.
 * The GMI is the central cognitive engine in AgentOS.
 * @module backend/agentos/cognitive_substrate/IGMI
 */
/**
 * Defines the possible moods a GMI can be in, influencing its behavior and responses.
 * These moods can be adapted based on interaction context or self-reflection.
 * @enum {string}
 */
export var GMIMood;
(function (GMIMood) {
    GMIMood["NEUTRAL"] = "neutral";
    GMIMood["FOCUSED"] = "focused";
    GMIMood["EMPATHETIC"] = "empathetic";
    GMIMood["CURIOUS"] = "curious";
    GMIMood["ASSERTIVE"] = "assertive";
    GMIMood["ANALYTICAL"] = "analytical";
    GMIMood["FRUSTRATED"] = "frustrated";
    GMIMood["CREATIVE"] = "creative";
})(GMIMood || (GMIMood = {}));
/**
 * Defines the primary operational states of a GMI.
 * @enum {string}
 */
export var GMIPrimeState;
(function (GMIPrimeState) {
    GMIPrimeState["IDLE"] = "idle";
    GMIPrimeState["INITIALIZING"] = "initializing";
    GMIPrimeState["READY"] = "ready";
    GMIPrimeState["PROCESSING"] = "processing";
    GMIPrimeState["AWAITING_TOOL_RESULT"] = "awaiting_tool_result";
    GMIPrimeState["REFLECTING"] = "reflecting";
    GMIPrimeState["ERRORED"] = "errored";
    GMIPrimeState["SHUTTING_DOWN"] = "shutting_down";
    GMIPrimeState["SHUTDOWN"] = "shutdown";
})(GMIPrimeState || (GMIPrimeState = {}));
/**
 * Defines the type of interaction or input being provided to the GMI.
 * @enum {string}
 */
export var GMIInteractionType;
(function (GMIInteractionType) {
    GMIInteractionType["TEXT"] = "text";
    GMIInteractionType["MULTIMODAL_CONTENT"] = "multimodal_content";
    GMIInteractionType["TOOL_RESPONSE"] = "tool_response";
    GMIInteractionType["SYSTEM_MESSAGE"] = "system_message";
    GMIInteractionType["LIFECYCLE_EVENT"] = "lifecycle_event";
})(GMIInteractionType || (GMIInteractionType = {}));
/**
 * Defines the type of content in a `GMIOutputChunk`.
 * @enum {string}
 */
export var GMIOutputChunkType;
(function (GMIOutputChunkType) {
    GMIOutputChunkType["TEXT_DELTA"] = "text_delta";
    GMIOutputChunkType["TOOL_CALL_REQUEST"] = "tool_call_request";
    GMIOutputChunkType["REASONING_STATE_UPDATE"] = "reasoning_state_update";
    GMIOutputChunkType["FINAL_RESPONSE_MARKER"] = "final_response_marker";
    GMIOutputChunkType["ERROR"] = "error";
    GMIOutputChunkType["SYSTEM_MESSAGE"] = "system_message";
    GMIOutputChunkType["USAGE_UPDATE"] = "usage_update";
    GMIOutputChunkType["LATENCY_REPORT"] = "latency_report";
    GMIOutputChunkType["UI_COMMAND"] = "ui_command";
})(GMIOutputChunkType || (GMIOutputChunkType = {}));
/**
 * Types of entries that can appear in a GMI's reasoning trace.
 * @enum {string}
 */
export var ReasoningEntryType;
(function (ReasoningEntryType) {
    ReasoningEntryType["LIFECYCLE"] = "LIFECYCLE";
    ReasoningEntryType["INTERACTION_START"] = "INTERACTION_START";
    ReasoningEntryType["INTERACTION_END"] = "INTERACTION_END";
    ReasoningEntryType["STATE_CHANGE"] = "STATE_CHANGE";
    ReasoningEntryType["PROMPT_CONSTRUCTION_START"] = "PROMPT_CONSTRUCTION_START";
    ReasoningEntryType["PROMPT_CONSTRUCTION_DETAIL"] = "PROMPT_CONSTRUCTION_DETAIL";
    ReasoningEntryType["PROMPT_CONSTRUCTION_COMPLETE"] = "PROMPT_CONSTRUCTION_COMPLETE";
    ReasoningEntryType["LLM_CALL_START"] = "LLM_CALL_START";
    ReasoningEntryType["LLM_CALL_COMPLETE"] = "LLM_CALL_COMPLETE";
    ReasoningEntryType["LLM_RESPONSE_CHUNK"] = "LLM_RESPONSE_CHUNK";
    ReasoningEntryType["LLM_USAGE"] = "LLM_USAGE";
    ReasoningEntryType["TOOL_CALL_REQUESTED"] = "TOOL_CALL_REQUESTED";
    ReasoningEntryType["TOOL_PERMISSION_CHECK_START"] = "TOOL_PERMISSION_CHECK_START";
    ReasoningEntryType["TOOL_PERMISSION_CHECK_RESULT"] = "TOOL_PERMISSION_CHECK_RESULT";
    ReasoningEntryType["TOOL_ARGUMENT_VALIDATION"] = "TOOL_ARGUMENT_VALIDATION";
    ReasoningEntryType["TOOL_EXECUTION_START"] = "TOOL_EXECUTION_START";
    ReasoningEntryType["TOOL_EXECUTION_RESULT"] = "TOOL_EXECUTION_RESULT";
    ReasoningEntryType["RAG_QUERY_START"] = "RAG_QUERY_START";
    ReasoningEntryType["RAG_QUERY_DETAIL"] = "RAG_QUERY_DETAIL";
    ReasoningEntryType["RAG_QUERY_RESULT"] = "RAG_QUERY_RESULT";
    ReasoningEntryType["RAG_INGESTION_START"] = "RAG_INGESTION_START";
    ReasoningEntryType["RAG_INGESTION_DETAIL"] = "RAG_INGESTION_DETAIL";
    ReasoningEntryType["RAG_INGESTION_COMPLETE"] = "RAG_INGESTION_COMPLETE";
    ReasoningEntryType["SELF_REFLECTION_TRIGGERED"] = "SELF_REFLECTION_TRIGGERED";
    ReasoningEntryType["SELF_REFLECTION_START"] = "SELF_REFLECTION_START";
    ReasoningEntryType["SELF_REFLECTION_DETAIL"] = "SELF_REFLECTION_DETAIL";
    ReasoningEntryType["SELF_REFLECTION_COMPLETE"] = "SELF_REFLECTION_COMPLETE";
    ReasoningEntryType["SELF_REFLECTION_SKIPPED"] = "SELF_REFLECTION_SKIPPED";
    ReasoningEntryType["MEMORY_LIFECYCLE_EVENT_RECEIVED"] = "MEMORY_LIFECYCLE_EVENT_RECEIVED";
    ReasoningEntryType["MEMORY_LIFECYCLE_NEGOTIATION_START"] = "MEMORY_LIFECYCLE_NEGOTIATION_START";
    ReasoningEntryType["MEMORY_LIFECYCLE_RESPONSE_SENT"] = "MEMORY_LIFECYCLE_RESPONSE_SENT";
    ReasoningEntryType["HEALTH_CHECK_REQUESTED"] = "HEALTH_CHECK_REQUESTED";
    ReasoningEntryType["HEALTH_CHECK_RESULT"] = "HEALTH_CHECK_RESULT";
    ReasoningEntryType["WARNING"] = "WARNING";
    ReasoningEntryType["ERROR"] = "ERROR";
    ReasoningEntryType["DEBUG"] = "DEBUG";
})(ReasoningEntryType || (ReasoningEntryType = {}));
//# sourceMappingURL=IGMI.js.map