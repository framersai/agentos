// File: backend/agentos/config/AgentOSConfig.ts
/**
 * @fileoverview Centralized configuration factory for AgentOS.
 * This module provides the `createAgentOSConfig` function that assembles
 * all required configurations and service instances needed to initialize
 * the AgentOS system. It handles environment variable reading, service
 * instantiation, and configuration validation.
 *
 * @module backend/agentos/config/AgentOSConfig
 */

import { PrismaClient } from '@prisma/client';
import { AgentOSConfig } from '../api/AgentOS';
import { GMIManagerConfig } from '../cognitive_substrate/GMIManager';
import { AgentOSOrchestratorConfig } from '../api/AgentOSOrchestrator';
import { PromptEngineConfig } from '../core/llm/IPromptEngine';
import { ToolOrchestratorConfig } from './ToolOrchestratorConfig';
import { ToolPermissionManagerConfig } from '../core/tools/permissions/IToolPermissionManager';
import { ConversationManagerConfig } from '../core/conversation/ConversationManager';
import { StreamingManagerConfig } from '../core/streaming/StreamingManager';
import { AIModelProviderManagerConfig, ProviderConfigEntry } from '../core/llm/providers/AIModelProviderManager';
import { PersonaLoaderConfig } from '../cognitive_substrate/personas/IPersonaLoader';

// Service implementations
import { AuthService } from '../services/user_auth/AuthService';
import { SubscriptionService } from '../services/user_auth/SubscriptionService';
import type { IAuthService, ISubscriptionService } from '../services/user_auth/types';
import { IUtilityAI } from '../core/ai_utilities/IUtilityAI';
import { IPromptEngineUtilityAI } from '../core/llm/IPromptEngine';

// Utility for error handling
import { GMIError, GMIErrorCode } from '@agentos/core/utils/errors';

/**
 * Environment-based configuration interface.
 * Defines expected environment variables with their types and defaults.
 */
export interface EnvironmentConfig {
  // Database
  DATABASE_URL: string;

  // Authentication & Security
  JWT_SECRET: string;
  JWT_EXPIRES_IN?: string;
  API_KEY_ENCRYPTION_KEY_HEX: string;

  // OAuth Configuration
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_CALLBACK_URL?: string;

  // LLM Provider Configuration
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OLLAMA_BASE_URL?: string;

  // LemonSqueezy Integration
  LEMONSQUEEZY_API_KEY?: string;
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
  LEMONSQUEEZY_STORE_ID?: string;

  // Application Configuration
  DEFAULT_PERSONA_ID?: string;
  NODE_ENV?: string;
  
  // Feature Flags
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
export function validateEnvironmentConfig(env: Partial<EnvironmentConfig>): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required variables
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'API_KEY_ENCRYPTION_KEY_HEX'
  ];

  for (const key of required) {
    if (!env[key as keyof EnvironmentConfig]) {
      errors.push(`Missing required environment variable: ${key}`);
    }
  }

  // Validate JWT_SECRET strength
  if (env.JWT_SECRET && env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters long');
  }

  // Validate API_KEY_ENCRYPTION_KEY_HEX format
  if (env.API_KEY_ENCRYPTION_KEY_HEX) {
    if (env.API_KEY_ENCRYPTION_KEY_HEX.length !== 64) {
      errors.push('API_KEY_ENCRYPTION_KEY_HEX must be exactly 64 characters (32 bytes in hex)');
    }
    if (!/^[0-9a-fA-F]+$/.test(env.API_KEY_ENCRYPTION_KEY_HEX)) {
      errors.push('API_KEY_ENCRYPTION_KEY_HEX must contain only hexadecimal characters');
    }
  }

  // Warnings for missing optional but recommended variables
  if (!env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY && !env.OPENROUTER_API_KEY && !env.OLLAMA_BASE_URL) {
    warnings.push('No LLM provider API keys configured. AgentOS will have limited functionality.');
  }

  if (!env.DEFAULT_PERSONA_ID) {
    warnings.push('DEFAULT_PERSONA_ID not set. Will use fallback default.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Reads and validates environment configuration.
 * 
 * @returns Validated environment configuration
 * @throws GMIError if required environment variables are missing
 */
export function getEnvironmentConfig(): EnvironmentConfig {
  const env: Partial<EnvironmentConfig> = {
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
    API_KEY_ENCRYPTION_KEY_HEX: process.env.API_KEY_ENCRYPTION_KEY_HEX,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    LEMONSQUEEZY_API_KEY: process.env.LEMONSQUEEZY_API_KEY,
    LEMONSQUEEZY_WEBHOOK_SECRET: process.env.LEMONSQUEEZY_WEBHOOK_SECRET,
    LEMONSQUEEZY_STORE_ID: process.env.LEMONSQUEEZY_STORE_ID,
    // Prefer V by default; fall back to Nerf if V not present in a deployment
    DEFAULT_PERSONA_ID: process.env.DEFAULT_PERSONA_ID || 'v_researcher',
    NODE_ENV: process.env.NODE_ENV || 'development',
    ENABLE_PERSISTENCE: process.env.ENABLE_PERSISTENCE || 'true',
    ENABLE_UTILITY_AI: process.env.ENABLE_UTILITY_AI || 'false',
    MAX_CONCURRENT_STREAMS: process.env.MAX_CONCURRENT_STREAMS || '1000',
    MAX_TOOL_CALL_ITERATIONS: process.env.MAX_TOOL_CALL_ITERATIONS || '5'
  };

  const validation = validateEnvironmentConfig(env);
  
  // Log warnings
  if (validation.warnings.length > 0) {
    console.warn('AgentOS Configuration Warnings:');
    validation.warnings.forEach(warning => console.warn(`  - ${warning}`));
  }

  // Throw error if validation fails
  if (!validation.isValid) {
    const errorMessage = `AgentOS Configuration Errors:\n${validation.errors.map(e => `  - ${e}`).join('\n')}`;
    throw new GMIError(
      errorMessage,
      GMIErrorCode.CONFIGURATION_ERROR,
      { errors: validation.errors, warnings: validation.warnings }
    );
  }

  return env as EnvironmentConfig;
}

/**
 * Creates the Persona Loader configuration.
 * 
 * @param env - Environment configuration
 * @returns PersonaLoaderConfig
 */
function createPersonaLoaderConfig(env: EnvironmentConfig): PersonaLoaderConfig {
  return {
    personaSource: './personas',
    loaderType: 'file_system',
    options: {
      enableFileWatching: env.NODE_ENV === 'development',
      validationLevel: 'strict',
      defaultPersonaId: env.DEFAULT_PERSONA_ID || 'v_researcher',
      cachePersonaDefinitions: true,
    },
  };
}

/**
 * Creates the AI Model Provider Manager configuration.
 * 
 * @param env - Environment configuration
 * @returns AIModelProviderManagerConfig
 */
function createModelProviderManagerConfig(env: EnvironmentConfig): AIModelProviderManagerConfig {
  const providers: ProviderConfigEntry[] = [];

  // OpenAI Provider
  if (env.OPENAI_API_KEY) {
    providers.push({
      providerId: 'openai',
      enabled: true,
      isDefault: true, // Make OpenAI default if available
      config: {
        apiKey: env.OPENAI_API_KEY,
        baseURL: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o',
        maxRetries: 3,
        timeout: 60000
      }
    });
  }

  // OpenRouter Provider
  if (env.OPENROUTER_API_KEY) {
    providers.push({
      providerId: 'openrouter',
      enabled: true,
      isDefault: !env.OPENAI_API_KEY, // Default to OpenRouter if OpenAI not available
      config: {
        apiKey: env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultModel: 'openai/gpt-4o',
        maxRetries: 3,
        timeout: 60000
      }
    });
  }

  // Ollama Provider (local)
  if (env.OLLAMA_BASE_URL) {
    providers.push({
      providerId: 'ollama',
      enabled: true,
      isDefault: !env.OPENAI_API_KEY && !env.OPENROUTER_API_KEY,
      config: {
        baseURL: env.OLLAMA_BASE_URL,
        defaultModel: 'llama3.2',
        timeout: 120000 // Longer timeout for local models
      }
    });
  }

  // Ensure at least one provider is marked as default
  if (providers.length > 0 && !providers.some(p => p.isDefault)) {
    providers[0].isDefault = true;
  }

  return { providers };
}

/**
 * Creates a LemonSqueezy service instance (stub for now).
 * In a real implementation, this would be a proper service class.
 */
function createLemonSqueezyService(env: EnvironmentConfig) {
  return {
    initialize: async () => { /* implementation */ },
    verifyWebhookSignature: (rawBody: string, signature: string) => true,
    processWebhookEvent: async (eventName: string, data: any) => { /* implementation */ }
  };
}

/**
 * Creates and initializes the AuthService instance.
 * 
 * @param prisma - Prisma client instance
 * @param env - Environment configuration
 * @returns Initialized AuthService
 */
async function createAuthService(): Promise<IAuthService> {
  const authService = new AuthService();
  if (typeof authService.initialize === 'function') {
    await authService.initialize();
  }
  return authService;
}

/**
 * Creates and initializes the SubscriptionService instance.
 * 
 * @param prisma - Prisma client instance
 * @param authService - Initialized auth service
 * @param env - Environment configuration
 * @returns Initialized SubscriptionService
 */
async function createSubscriptionService(): Promise<ISubscriptionService> {
  const subscriptionService = new SubscriptionService();
  if (typeof subscriptionService.initialize === 'function') {
    await subscriptionService.initialize();
  }
  return subscriptionService;
}

/**
 * Creates a utility AI service instance if enabled.
 * This is a placeholder - implement based on your UtilityAI implementation.
 * 
 * @param env - Environment configuration
 * @returns UtilityAI service or undefined
 */
async function createUtilityAIService(env: EnvironmentConfig): Promise<(IUtilityAI & IPromptEngineUtilityAI) | undefined> {
  if (env.ENABLE_UTILITY_AI === 'true') {
    // TODO: Implement your UtilityAI service
    // const utilityAI = new YourUtilityAIService();
    // await utilityAI.initialize({ ... });
    // return utilityAI;
  }
  return undefined;
}

/**
 * Main function to create the complete AgentOS configuration.
 * 
 * @returns Promise resolving to a complete AgentOSConfig
 * @throws GMIError if configuration creation fails
 */
export async function createAgentOSConfig(): Promise<AgentOSConfig> {
  console.log('AgentOS Config: Starting configuration creation...');
  
  try {
    // Load and validate environment
    const env = getEnvironmentConfig();
    
    // Create Prisma client
    const prisma = new PrismaClient();
    console.log('AgentOS Config: Prisma client stub initialized');

    const defaultPersonaId = env.DEFAULT_PERSONA_ID || 'v_researcher';

    // Create and initialize services
    const authService = await createAuthService();
    const subscriptionService = await createSubscriptionService();
    const utilityAIService = await createUtilityAIService(env);

    // Create individual component configurations
    const gmiManagerConfig: GMIManagerConfig = {
      personaLoaderConfig: createPersonaLoaderConfig(env),
      defaultGMIInactivityCleanupMinutes: 60,
      defaultWorkingMemoryType: 'in_memory',
      defaultGMIBaseConfigDefaults: {
        defaultLlmProviderId: 'openai',
        defaultLlmModelId: 'gpt-4o'
      }
    };

    const orchestratorConfig: AgentOSOrchestratorConfig = {
      maxToolCallIterations: parseInt(env.MAX_TOOL_CALL_ITERATIONS || '5'),
      defaultAgentTurnTimeoutMs: 120000,
      enableConversationalPersistence: env.ENABLE_PERSISTENCE === 'true'
    };

    const promptEngineConfig: PromptEngineConfig = {
      defaultTemplateName: 'openai_chat',
      availableTemplates: {},
      tokenCounting: {
        strategy: 'estimated',
        estimationModel: 'gpt-3.5-turbo',
      },
      historyManagement: {
        defaultMaxMessages: 40,
        maxTokensForHistory: 4000,
        summarizationTriggerRatio: 0.8,
        preserveImportantMessages: true,
      },
      contextManagement: {
        maxRAGContextTokens: 1500,
        summarizationQualityTier: 'balanced',
        preserveSourceAttributionInSummary: true,
      },
      contextualElementSelection: {
        maxElementsPerType: {},
        defaultMaxElementsPerType: 3,
        priorityResolutionStrategy: 'highest_first',
        conflictResolutionStrategy: 'skip_conflicting',
      },
      performance: {
        enableCaching: true,
        cacheTimeoutSeconds: 120,
      },
    };

    const toolOrchestratorConfig: ToolOrchestratorConfig = {
      orchestratorId: 'default-tool-orchestrator',
      defaultToolCallTimeoutMs: 30000,
      maxConcurrentToolCalls: 10,
      logToolCalls: env.NODE_ENV === 'development',
      globalDisabledTools: [],
      toolRegistrySettings: {
        allowDynamicRegistration: true,
        persistRegistry: false
      }
    };

    const toolPermissionManagerConfig: ToolPermissionManagerConfig = {
      strictCapabilityChecking: true,
      logToolCalls: env.NODE_ENV === 'development',
      toolToSubscriptionFeatures: {
        // Example: map specific tools to subscription features
        'advanced_search_tool': [
          { flag: 'FEATURE_ADVANCED_SEARCH', description: 'Access to advanced search capabilities' }
        ]
      }
    };

    const conversationManagerConfig: ConversationManagerConfig = {
      defaultConversationContextConfig: {
        maxHistoryLengthMessages: 100,
        enableAutomaticSummarization: true,
        messagesToKeepVerbatimTail: 5,
        messagesToKeepVerbatimHead: 2,
      },
      maxActiveConversationsInMemory: 1000,
      inactivityTimeoutMs: 3600000,
      persistenceEnabled: env.ENABLE_PERSISTENCE === 'true'
    };

    const streamingManagerConfig: StreamingManagerConfig = {
      maxConcurrentStreams: parseInt(env.MAX_CONCURRENT_STREAMS || '1000'),
      defaultStreamInactivityTimeoutMs: 300000, // 5 minutes
      maxClientsPerStream: 10,
      onClientSendErrorBehavior: 'log_and_continue'
    };

    const modelProviderManagerConfig = createModelProviderManagerConfig(env);

    // Assemble final configuration
    const config: AgentOSConfig = {
      gmiManagerConfig,
      orchestratorConfig,
      promptEngineConfig,
      toolOrchestratorConfig,
      toolPermissionManagerConfig,
      conversationManagerConfig,
      streamingManagerConfig,
      modelProviderManagerConfig,
      defaultPersonaId,
      prisma,
      authService,
      subscriptionService,
      utilityAIService
    };

    console.log('AgentOS Config: Configuration created successfully');
    console.log(`AgentOS Config: Environment: ${env.NODE_ENV}`);
    console.log(`AgentOS Config: Persistence enabled: ${env.ENABLE_PERSISTENCE}`);
    console.log(`AgentOS Config: LLM providers configured: ${modelProviderManagerConfig.providers.length}`);
    console.log(`AgentOS Config: Default persona: ${defaultPersonaId}`);

    return config;

  } catch (error: any) {
    console.error('AgentOS Config: Failed to create configuration:', error);
    
    if (error instanceof GMIError) {
      throw error;
    }
    
    throw new GMIError(
      `Failed to create AgentOS configuration: ${error.message}`,
      GMIErrorCode.CONFIGURATION_ERROR,
      { originalError: error }
    );
  }
}

/**
 * Helper function to create a test configuration for development/testing.
 * This bypasses some environment requirements and uses sensible defaults.
 * 
 * @returns Promise resolving to a test AgentOSConfig
 */
export async function createTestAgentOSConfig(): Promise<AgentOSConfig> {
  // Set minimal test environment
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'file:./test.db';
  }
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-jwt-secret-for-development-only-minimum-32-chars';
  }
  if (!process.env.API_KEY_ENCRYPTION_KEY_HEX) {
    process.env.API_KEY_ENCRYPTION_KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  }
  
  return createAgentOSConfig();
}
