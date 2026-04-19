/**
 * @fileoverview Custom error class for AgentOS service facade errors.
 */
import { GMIError } from '../core/utils/errors.js';
/**
 * Custom error class for errors specifically originating from the AgentOS service facade.
 * Provides a standardized way to represent errors encountered within the `AgentOS` class.
 */
export class AgentOSServiceError extends GMIError {
    constructor(message, code, details, componentOrigin) {
        super(message, code, details, componentOrigin);
        this.name = 'AgentOSServiceError';
        Object.setPrototypeOf(this, AgentOSServiceError.prototype);
    }
    /**
     * Wraps an existing error within a new AgentOSServiceError instance.
     */
    static wrap(error, code, message, componentOrigin) {
        const baseMessage = error instanceof Error ? error.message : String(error);
        const originalComponent = error instanceof GMIError ? error.component : undefined;
        const originalDetails = error instanceof GMIError ? error.details : { underlyingError: error };
        return new AgentOSServiceError(`${message}: ${baseMessage}`, code, originalDetails, componentOrigin || originalComponent);
    }
}
//# sourceMappingURL=errors.js.map