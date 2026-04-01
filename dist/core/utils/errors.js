// Shared error helpers used across AgentOS and embedding applications.
export class AppError extends Error {
    constructor(message, statusCode = 500, isOperational = true) {
        super(message);
        this.message = message;
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        Object.setPrototypeOf(this, AppError.prototype);
    }
}
export class ValidationError extends AppError {
    constructor(message) {
        super(message, 400, true);
    }
}
export class AuthenticationError extends AppError {
    constructor(message = 'Authentication failed') {
        super(message, 401, true);
    }
}
export class NotFoundError extends AppError {
    constructor(message = 'Resource not found') {
        super(message, 404, true);
    }
}
export var GMIErrorCode;
(function (GMIErrorCode) {
    GMIErrorCode["INTERNAL_SERVER_ERROR"] = "SYS_INTERNAL_SERVER_ERROR";
    GMIErrorCode["INTERNAL_ERROR"] = "SYS_INTERNAL_ERROR";
    GMIErrorCode["SERVICE_UNAVAILABLE"] = "SYS_SERVICE_UNAVAILABLE";
    GMIErrorCode["NOT_INITIALIZED"] = "SYS_NOT_INITIALIZED";
    GMIErrorCode["INITIALIZATION_FAILED"] = "SYS_INITIALIZATION_FAILED";
    GMIErrorCode["CONFIGURATION_ERROR"] = "SYS_CONFIGURATION_ERROR";
    GMIErrorCode["CONFIG_ERROR"] = "SYS_CONFIG_ERROR";
    GMIErrorCode["VALIDATION_ERROR"] = "SYS_VALIDATION_ERROR";
    GMIErrorCode["INVALID_ARGUMENT"] = "SYS_INVALID_ARGUMENT";
    GMIErrorCode["INVALID_STATE"] = "SYS_INVALID_STATE";
    GMIErrorCode["PARSING_ERROR"] = "SYS_PARSING_ERROR";
    GMIErrorCode["DEPENDENCY_ERROR"] = "SYS_DEPENDENCY_ERROR";
    GMIErrorCode["MISSING_DEPENDENCY"] = "SYS_MISSING_DEPENDENCY";
    GMIErrorCode["MISSING_DATA"] = "SYS_MISSING_DATA";
    GMIErrorCode["NOT_IMPLEMENTED"] = "SYS_NOT_IMPLEMENTED";
    GMIErrorCode["NOT_SUPPORTED"] = "SYS_NOT_SUPPORTED";
    GMIErrorCode["METHOD_NOT_SUPPORTED"] = "SYS_METHOD_NOT_SUPPORTED";
    GMIErrorCode["PROCESSING_ERROR"] = "SYS_PROCESSING_ERROR";
    GMIErrorCode["STREAM_ERROR"] = "SYS_STREAM_ERROR";
    GMIErrorCode["DATABASE_ERROR"] = "SYS_DATABASE_ERROR";
    GMIErrorCode["RATE_LIMIT_EXCEEDED"] = "SYS_RATE_LIMIT_EXCEEDED";
    GMIErrorCode["TIMEOUT"] = "SYS_TIMEOUT";
    GMIErrorCode["NOT_FOUND"] = "SYS_NOT_FOUND";
    GMIErrorCode["RESOURCE_NOT_FOUND"] = "SYS_RESOURCE_NOT_FOUND";
    GMIErrorCode["RESOURCE_ALREADY_EXISTS"] = "SYS_RESOURCE_ALREADY_EXISTS";
    GMIErrorCode["ALREADY_EXISTS"] = "SYS_ALREADY_EXISTS";
    GMIErrorCode["AUTHENTICATION_REQUIRED"] = "AUTH_AUTHENTICATION_REQUIRED";
    GMIErrorCode["PERMISSION_DENIED"] = "AUTH_PERMISSION_DENIED";
    GMIErrorCode["ACCESS_DENIED"] = "AUTH_ACCESS_DENIED";
    GMIErrorCode["SUBSCRIPTION_ERROR"] = "AUTH_SUBSCRIPTION_ERROR";
    GMIErrorCode["PERSONA_NOT_FOUND"] = "GMI_PERSONA_NOT_FOUND";
    GMIErrorCode["PERSONA_LOAD_ERROR"] = "GMI_PERSONA_LOAD_ERROR";
    GMIErrorCode["GMI_INITIALIZATION_ERROR"] = "GMI_INITIALIZATION_ERROR";
    GMIErrorCode["GMI_PROCESSING_ERROR"] = "GMI_PROCESSING_ERROR";
    GMIErrorCode["GMI_CONTEXT_ERROR"] = "GMI_CONTEXT_ERROR";
    GMIErrorCode["GMI_FEEDBACK_ERROR"] = "GMI_FEEDBACK_ERROR";
    GMIErrorCode["GMI_SHUTDOWN_ERROR"] = "GMI_SHUTDOWN_ERROR";
    GMIErrorCode["TOOL_ERROR"] = "TOOL_ERROR";
    GMIErrorCode["TOOL_NOT_FOUND"] = "TOOL_NOT_FOUND";
    GMIErrorCode["TOOL_EXECUTION_FAILED"] = "TOOL_EXECUTION_FAILED";
    GMIErrorCode["LLM_PROVIDER_ERROR"] = "LLM_PROVIDER_ERROR";
    GMIErrorCode["LLM_PROVIDER_UNAVAILABLE"] = "LLM_PROVIDER_UNAVAILABLE";
    GMIErrorCode["PROVIDER_ERROR"] = "PROVIDER_ERROR";
    GMIErrorCode["PROVIDER_NOT_FOUND"] = "PROVIDER_NOT_FOUND";
    GMIErrorCode["RAG_INGESTION_FAILED"] = "RAG_INGESTION_FAILED";
})(GMIErrorCode || (GMIErrorCode = {}));
const DEFAULT_HTTP_STATUS = 500;
const DEFAULT_FRIENDLY_MESSAGE = 'An unexpected error occurred.';
const statusCodeMap = {
    [GMIErrorCode.INTERNAL_SERVER_ERROR]: 500,
    [GMIErrorCode.INTERNAL_ERROR]: 500,
    [GMIErrorCode.SERVICE_UNAVAILABLE]: 503,
    [GMIErrorCode.NOT_INITIALIZED]: 500,
    [GMIErrorCode.INITIALIZATION_FAILED]: 500,
    [GMIErrorCode.CONFIGURATION_ERROR]: 500,
    [GMIErrorCode.CONFIG_ERROR]: 500,
    [GMIErrorCode.VALIDATION_ERROR]: 400,
    [GMIErrorCode.INVALID_ARGUMENT]: 400,
    [GMIErrorCode.INVALID_STATE]: 409,
    [GMIErrorCode.PARSING_ERROR]: 400,
    [GMIErrorCode.DEPENDENCY_ERROR]: 500,
    [GMIErrorCode.MISSING_DEPENDENCY]: 500,
    [GMIErrorCode.MISSING_DATA]: 400,
    [GMIErrorCode.NOT_IMPLEMENTED]: 501,
    [GMIErrorCode.NOT_SUPPORTED]: 501,
    [GMIErrorCode.METHOD_NOT_SUPPORTED]: 405,
    [GMIErrorCode.PROCESSING_ERROR]: 500,
    [GMIErrorCode.GMI_PROCESSING_ERROR]: 500,
    [GMIErrorCode.STREAM_ERROR]: 500,
    [GMIErrorCode.DATABASE_ERROR]: 500,
    [GMIErrorCode.RATE_LIMIT_EXCEEDED]: 429,
    [GMIErrorCode.TIMEOUT]: 504,
    [GMIErrorCode.NOT_FOUND]: 404,
    [GMIErrorCode.RESOURCE_NOT_FOUND]: 404,
    [GMIErrorCode.PERSONA_NOT_FOUND]: 404,
    [GMIErrorCode.TOOL_NOT_FOUND]: 404,
    [GMIErrorCode.PROVIDER_NOT_FOUND]: 404,
    [GMIErrorCode.RESOURCE_ALREADY_EXISTS]: 409,
    [GMIErrorCode.ALREADY_EXISTS]: 409,
    [GMIErrorCode.AUTHENTICATION_REQUIRED]: 401,
    [GMIErrorCode.PERMISSION_DENIED]: 403,
    [GMIErrorCode.ACCESS_DENIED]: 403,
    [GMIErrorCode.SUBSCRIPTION_ERROR]: 402,
    [GMIErrorCode.LLM_PROVIDER_UNAVAILABLE]: 503,
};
const userFriendlyMessageMap = {
    [GMIErrorCode.INTERNAL_SERVER_ERROR]: DEFAULT_FRIENDLY_MESSAGE,
    [GMIErrorCode.SERVICE_UNAVAILABLE]: 'The service is temporarily unavailable. Please try again shortly.',
    [GMIErrorCode.AUTHENTICATION_REQUIRED]: 'Please log in to continue.',
    [GMIErrorCode.PERMISSION_DENIED]: "You do not have permission to perform that action.",
    [GMIErrorCode.ACCESS_DENIED]: "You don't have access to this resource.",
    [GMIErrorCode.NOT_FOUND]: 'We could not find what you were looking for.',
    [GMIErrorCode.RESOURCE_NOT_FOUND]: 'We could not find what you were looking for.',
    [GMIErrorCode.PERSONA_NOT_FOUND]: 'That persona is not available.',
    [GMIErrorCode.SUBSCRIPTION_ERROR]: 'Please upgrade your plan to access this feature.',
    [GMIErrorCode.RATE_LIMIT_EXCEEDED]: 'You are sending requests too quickly. Please slow down.',
};
export class GMIError extends Error {
    constructor(message, code, details, component, httpStatusCode, cause) {
        super(message);
        this.name = 'GMIError';
        this.code = code;
        this.details = details;
        this.component = component;
        this.httpStatusCode = httpStatusCode;
        this.cause = cause;
        this.timestamp = new Date().toISOString();
        Object.setPrototypeOf(this, GMIError.prototype);
    }
    getHttpStatusCode() {
        if (typeof this.httpStatusCode === 'number') {
            return this.httpStatusCode;
        }
        const mapped = statusCodeMap[this.code];
        return mapped ?? DEFAULT_HTTP_STATUS;
    }
    getUserFriendlyMessage() {
        return userFriendlyMessageMap[this.code] ?? this.message ?? DEFAULT_FRIENDLY_MESSAGE;
    }
    toPlainObject() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            component: this.component,
            httpStatusCode: this.getHttpStatusCode(),
            details: this.details,
            timestamp: this.timestamp,
            stack: this.stack,
        };
    }
    toJSON() {
        return this.toPlainObject();
    }
    static isGMIError(error) {
        return error instanceof GMIError;
    }
    static wrap(error, code, message, componentOrigin) {
        return createGMIErrorFromError(error, code, undefined, message, componentOrigin);
    }
}
export function createGMIErrorFromError(error, code, contextDetails, overrideMessage, componentOrigin) {
    if (error instanceof GMIError) {
        return new GMIError(overrideMessage ? `${overrideMessage}: ${error.message}` : error.message, code ?? error.code, mergeDetails(error.details, contextDetails), componentOrigin ?? error.component, error.httpStatusCode, error);
    }
    const baseMessage = error instanceof Error ? error.message : String(error);
    const mergedDetails = mergeDetails(normalizeUnknownError(error), contextDetails);
    return new GMIError(overrideMessage ? `${overrideMessage}: ${baseMessage}` : baseMessage, code, mergedDetails, componentOrigin, undefined, error);
}
function mergeDetails(...details) {
    const merged = {};
    for (const detail of details) {
        if (detail && typeof detail === 'object') {
            Object.assign(merged, detail);
        }
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
}
function normalizeUnknownError(error) {
    if (error instanceof Error) {
        return {
            underlyingError: {
                name: error.name,
                message: error.message,
                stack: error.stack,
            },
        };
    }
    if (error && typeof error === 'object') {
        return { underlyingError: error };
    }
    return error === undefined ? undefined : { underlyingError: { value: error } };
}
//# sourceMappingURL=errors.js.map