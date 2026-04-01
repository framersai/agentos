/**
 * @file ITracer.ts
 * @description Interface for distributed tracing in AgentOS.
 *
 * Provides span-based tracing for tracking request flows across
 * GMIs, agencies, tool calls, and LLM interactions.
 *
 * @module AgentOS/Observability
 * @version 1.0.0
 */
/**
 * Creates a formatted trace ID for display.
 * @param traceId - The trace ID
 * @param spanId - The span ID
 * @returns Formatted string
 */
export function formatTraceId(traceId, spanId) {
    return spanId ? `${traceId.slice(0, 8)}:${spanId.slice(0, 8)}` : traceId.slice(0, 16);
}
/**
 * Semantic conventions for span attributes.
 */
export const SemanticAttributes = {
    // General
    SERVICE_NAME: 'service.name',
    SERVICE_VERSION: 'service.version',
    // GMI
    GMI_ID: 'gmi.id',
    GMI_PERSONA_ID: 'gmi.persona.id',
    GMI_CONVERSATION_ID: 'gmi.conversation.id',
    // Agency
    AGENCY_ID: 'agency.id',
    AGENCY_ROLE_ID: 'agency.role.id',
    // LLM
    LLM_PROVIDER: 'llm.provider',
    LLM_MODEL: 'llm.model',
    LLM_PROMPT_TOKENS: 'llm.prompt_tokens',
    LLM_COMPLETION_TOKENS: 'llm.completion_tokens',
    LLM_TOTAL_TOKENS: 'llm.total_tokens',
    // Tool
    TOOL_ID: 'tool.id',
    TOOL_NAME: 'tool.name',
    TOOL_RESULT_STATUS: 'tool.result.status',
    // Error
    EXCEPTION_TYPE: 'exception.type',
    EXCEPTION_MESSAGE: 'exception.message',
    EXCEPTION_STACKTRACE: 'exception.stacktrace',
    // HTTP (for external calls)
    HTTP_METHOD: 'http.method',
    HTTP_URL: 'http.url',
    HTTP_STATUS_CODE: 'http.status_code',
    // User
    USER_ID: 'user.id',
};
//# sourceMappingURL=ITracer.js.map