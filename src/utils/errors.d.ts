export declare class AppError extends Error {
    message: string;
    statusCode: number;
    isOperational: boolean;
    constructor(message: string, statusCode?: number, isOperational?: boolean);
}
export declare class ValidationError extends AppError {
    constructor(message: string);
}
export declare class AuthenticationError extends AppError {
    constructor(message?: string);
}
export declare class NotFoundError extends AppError {
    constructor(message?: string);
}
export declare enum GMIErrorCode {
    INTERNAL_SERVER_ERROR = "SYS_INTERNAL_SERVER_ERROR",
    INTERNAL_ERROR = "SYS_INTERNAL_ERROR",
    SERVICE_UNAVAILABLE = "SYS_SERVICE_UNAVAILABLE",
    NOT_INITIALIZED = "SYS_NOT_INITIALIZED",
    INITIALIZATION_FAILED = "SYS_INITIALIZATION_FAILED",
    CONFIGURATION_ERROR = "SYS_CONFIGURATION_ERROR",
    CONFIG_ERROR = "SYS_CONFIG_ERROR",
    VALIDATION_ERROR = "SYS_VALIDATION_ERROR",
    INVALID_ARGUMENT = "SYS_INVALID_ARGUMENT",
    INVALID_STATE = "SYS_INVALID_STATE",
    PARSING_ERROR = "SYS_PARSING_ERROR",
    DEPENDENCY_ERROR = "SYS_DEPENDENCY_ERROR",
    MISSING_DEPENDENCY = "SYS_MISSING_DEPENDENCY",
    MISSING_DATA = "SYS_MISSING_DATA",
    NOT_IMPLEMENTED = "SYS_NOT_IMPLEMENTED",
    NOT_SUPPORTED = "SYS_NOT_SUPPORTED",
    METHOD_NOT_SUPPORTED = "SYS_METHOD_NOT_SUPPORTED",
    PROCESSING_ERROR = "SYS_PROCESSING_ERROR",
    STREAM_ERROR = "SYS_STREAM_ERROR",
    DATABASE_ERROR = "SYS_DATABASE_ERROR",
    RATE_LIMIT_EXCEEDED = "SYS_RATE_LIMIT_EXCEEDED",
    TIMEOUT = "SYS_TIMEOUT",
    NOT_FOUND = "SYS_NOT_FOUND",
    RESOURCE_NOT_FOUND = "SYS_RESOURCE_NOT_FOUND",
    RESOURCE_ALREADY_EXISTS = "SYS_RESOURCE_ALREADY_EXISTS",
    ALREADY_EXISTS = "SYS_ALREADY_EXISTS",
    AUTHENTICATION_REQUIRED = "AUTH_AUTHENTICATION_REQUIRED",
    PERMISSION_DENIED = "AUTH_PERMISSION_DENIED",
    ACCESS_DENIED = "AUTH_ACCESS_DENIED",
    SUBSCRIPTION_ERROR = "AUTH_SUBSCRIPTION_ERROR",
    PERSONA_NOT_FOUND = "GMI_PERSONA_NOT_FOUND",
    PERSONA_LOAD_ERROR = "GMI_PERSONA_LOAD_ERROR",
    GMI_INITIALIZATION_ERROR = "GMI_INITIALIZATION_ERROR",
    GMI_PROCESSING_ERROR = "GMI_PROCESSING_ERROR",
    GMI_CONTEXT_ERROR = "GMI_CONTEXT_ERROR",
    GMI_FEEDBACK_ERROR = "GMI_FEEDBACK_ERROR",
    GMI_SHUTDOWN_ERROR = "GMI_SHUTDOWN_ERROR",
    TOOL_ERROR = "TOOL_ERROR",
    TOOL_NOT_FOUND = "TOOL_NOT_FOUND",
    TOOL_EXECUTION_FAILED = "TOOL_EXECUTION_FAILED",
    LLM_PROVIDER_ERROR = "LLM_PROVIDER_ERROR",
    LLM_PROVIDER_UNAVAILABLE = "LLM_PROVIDER_UNAVAILABLE",
    PROVIDER_ERROR = "PROVIDER_ERROR",
    PROVIDER_NOT_FOUND = "PROVIDER_NOT_FOUND",
    RAG_INGESTION_FAILED = "RAG_INGESTION_FAILED"
}
export type GMIErrorDetails = Record<string, any> | undefined;
export declare class GMIError extends Error {
    readonly code: GMIErrorCode | string;
    readonly details?: any;
    readonly component?: string;
    readonly timestamp: string;
    readonly httpStatusCode?: number;
    readonly cause?: unknown;
    constructor(message: string, code: GMIErrorCode | string, details?: any, component?: string, httpStatusCode?: number, cause?: unknown);
    getHttpStatusCode(): number;
    getUserFriendlyMessage(): string;
    toPlainObject(): Record<string, any>;
    toJSON(): Record<string, any>;
    static isGMIError(error: unknown): error is GMIError;
    static wrap(error: unknown, code: GMIErrorCode | string, message?: string, componentOrigin?: string): GMIError;
}
export declare function createGMIErrorFromError(error: unknown, code: GMIErrorCode | string, contextDetails?: any, overrideMessage?: string, componentOrigin?: string): GMIError;
//# sourceMappingURL=errors.d.ts.map