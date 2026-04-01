/**
 * @fileoverview Centralized configuration factory for AgentOS.
 * This module provides the `createAgentOSConfig` function that assembles
 * all required configurations and service instances needed to initialize
 * the AgentOS system. It handles environment variable reading, service
 * instantiation, and configuration validation.
 *
 * @module backend/agentos/config/AgentOSConfig
 */
import type { AgentOSConfig } from '../../api/AgentOS.js';
import type { ExternalToolRegistry } from '../../api/runtime/externalToolRegistry.js';
import type { AdaptableToolInput } from '../../api/runtime/toolAdapter.js';
/**
 * Environment-based configuration interface.
 * Defines expected environment variables with their types and defaults.
 */
export interface EnvironmentConfig {
    DATABASE_URL: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GOOGLE_CALLBACK_URL?: string;
    OPENAI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    OPENROUTER_API_KEY?: string;
    SERPER_API_KEY?: string;
    OLLAMA_BASE_URL?: string;
    LEMONSQUEEZY_API_KEY?: string;
    LEMONSQUEEZY_WEBHOOK_SECRET?: string;
    LEMONSQUEEZY_STORE_ID?: string;
    DEFAULT_PERSONA_ID?: string;
    NODE_ENV?: string;
    ENABLE_PERSISTENCE?: string;
    ENABLE_UTILITY_AI?: string;
    MAX_CONCURRENT_STREAMS?: string;
    MAX_TOOL_CALL_ITERATIONS?: string;
}
/**
 * Configuration validation result interface.
 */
export interface ConfigValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}
/**
 * Validates the environment configuration for required variables.
 *
 * @param env - The environment configuration object
 * @returns Validation result with errors and warnings
 */
export declare function validateEnvironmentConfig(env: Partial<EnvironmentConfig>): ConfigValidationResult;
/**
 * Reads and validates environment configuration.
 *
 * @returns Validated environment configuration
 * @throws GMIError if required environment variables are missing
 */
export declare function getEnvironmentConfig(): EnvironmentConfig;
export interface CreateAgentOSConfigOptions {
    /**
     * Optional runtime-level registered tools to place on `AgentOSConfig.tools`.
     * These will be registered into the shared `ToolOrchestrator` during
     * `AgentOS.initialize(...)`.
     */
    tools?: AdaptableToolInput;
    /**
     * Optional stable host-managed tool registry to place on
     * `AgentOSConfig.externalTools`.
     */
    externalTools?: ExternalToolRegistry;
}
/**
 * Main function to create the complete AgentOS configuration.
 *
 * @param options - Optional runtime tool inputs to apply to the generated config.
 * @returns Promise resolving to a complete AgentOSConfig
 * @throws GMIError if configuration creation fails
 */
export declare function createAgentOSConfig(options?: CreateAgentOSConfigOptions): Promise<AgentOSConfig>;
/**
 * Helper function to create a test configuration for development/testing.
 * This bypasses some environment requirements and uses sensible defaults.
 *
 * @param options - Optional runtime tool inputs to apply to the generated config.
 * @returns Promise resolving to a test AgentOSConfig
 */
export declare function createTestAgentOSConfig(options?: CreateAgentOSConfigOptions): Promise<AgentOSConfig>;
//# sourceMappingURL=AgentOSConfig.d.ts.map