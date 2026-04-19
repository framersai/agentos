/**
 * @fileoverview Custom error class for AgentOS service facade errors.
 */
import { GMIError, GMIErrorCode } from '../core/utils/errors';
/**
 * Custom error class for errors specifically originating from the AgentOS service facade.
 * Provides a standardized way to represent errors encountered within the `AgentOS` class.
 */
export declare class AgentOSServiceError extends GMIError {
    readonly name: string;
    constructor(message: string, code: GMIErrorCode | string, details?: any, componentOrigin?: string);
    /**
     * Wraps an existing error within a new AgentOSServiceError instance.
     */
    static wrap(error: any, code: GMIErrorCode | string, message: string, componentOrigin?: string): AgentOSServiceError;
}
//# sourceMappingURL=errors.d.ts.map