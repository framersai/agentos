/**
 * @fileoverview This file defines the comprehensive structures and interfaces for Persona Definitions
 * within AgentOS.
 * @module backend/agentos/cognitive_substrate/personas/IPersonaDefinition
 */
import { ModelCompletionOptions } from '../../core/llm/providers/IProvider';
import { PromptEngineConfig } from '../../core/llm/IPromptEngine';
import { ITool } from '../../core/tools/ITool';
export interface PersonaUserContextDefaults {
    skillLevel?: string;
    preferences?: Record<string, any>;
}
export interface PersonaTaskContextDefaults {
    domain?: string;
    complexity?: string;
    goal?: string;
}
/**
 * Specifies the configuration for a persona's voice when generating audio output (Text-to-Speech).
 * @interface PersonaVoiceConfig
 */
export interface PersonaVoiceConfig {
    provider?: string;
    voiceId?: string;
    languageCode?: string;
    customParams?: Record<string, any>;
    moodToVoiceStyleMap?: Record<string, {
        voiceId?: string;
        customParams?: Record<string, any>;
    }>;
}
/**
 * Defines the configuration for a persona's visual representation (avatar).
 * @interface PersonaAvatarConfig
 */
export interface PersonaAvatarConfig {
    type?: 'static_image' | 'animated_image' | 'realtime_generative_placeholder';
    sourceUrl?: string;
    descriptionForGeneration?: string;
    moodToAvatarStateMap?: Record<string, {
        sourceUrl?: string;
        generationPromptSuffix?: string;
    }>;
}
/**
 * Configures how a persona's mood adapts based on interaction context, user feedback, or internal state.
 * @interface PersonaMoodAdaptationConfig
 */
export interface PersonaMoodAdaptationConfig {
    enabled: boolean;
    sensitivityFactor?: number;
    defaultMood: string;
    allowedMoods?: string[];
    moodPrompts?: Record<string, string>;
}
/**
 * Defines preferences for selecting AI models for various tasks or under certain conditions.
 * @interface ModelTargetPreference
 */
export interface ModelTargetPreference {
    taskHint?: string;
    providerId?: string;
    modelId?: string;
    modelFamily?: string;
    minQualityTier?: 'fastest' | 'balanced' | 'best';
    maxCostPerKiloTokenInput?: number;
    maxCostPerKiloTokenOutput?: number;
    allowedModelIds?: string[];
    requiredCapabilities?: Array<'tool_use' | 'vision_input' | 'json_mode' | 'long_context' | string>;
}
/**
 * Configuration for how the persona manages and utilizes conversation history.
 * @interface PersonaConversationContextConfig
 */
export interface PersonaConversationContextConfig {
    maxMessages?: number;
    maxTokens?: number;
    overflowStrategy?: 'truncate' | 'summarize' | 'hybrid';
    summarizationTriggerTokens?: number;
    includeToolResults?: boolean;
    includeSystemMessages?: boolean;
}
/**
 * Configuration for a specific RAG (Retrieval Augmented Generation) data source
 * @interface PersonaRagDataSourceConfig
 */
export interface PersonaRagDataSourceConfig {
    id: string;
    dataSourceNameOrId: string;
    isEnabled: boolean;
    displayName?: string;
    defaultTopK?: number;
    defaultFilterMetadata?: Record<string, any>;
    priority?: number;
    relevanceThreshold?: number;
}
/**
 * Configuration for how memory (e.g., conversation history, retrieved documents) is processed by utility AI.
 * @interface PersonaUtilityProcessingConfig
 */
export interface PersonaUtilityProcessingConfig {
    engine: 'llm' | 'statistical' | 'none';
    llmConfig?: {
        providerId?: string;
        modelId?: string;
        promptTemplateName?: string;
        maxOutputTokens?: number;
    };
    statisticalConfig?: {
        summarizationMethod?: string;
        summarizationLength?: 'short' | 'medium' | 'long' | number;
        keywordExtractionMethod?: string;
        maxKeywords?: number;
    };
}
/**
 * Defines triggers for RAG retrieval.
 * @interface PersonaRagConfigRetrievalTrigger
 */
export interface PersonaRagConfigRetrievalTrigger {
    onUserQuery?: boolean;
    onIntentDetected?: string[];
    onToolFailure?: string[];
    onMissingContextKeywords?: string[];
    customLogicFunctionName?: string;
}
/**
 * Defines triggers for RAG ingestion (e.g., summarizing turns into RAG).
 * @interface PersonaRagConfigIngestionTrigger
 */
export interface PersonaRagConfigIngestionTrigger {
    onTurnSummary?: boolean;
    onExplicitUserCommand?: string;
    customLogicFunctionName?: string;
}
/**
 * Configuration for RAG ingestion processing.
 * @interface PersonaRagIngestionProcessingConfig
 */
export interface PersonaRagIngestionProcessingConfig {
    summarization?: {
        enabled: boolean;
        targetLength?: 'short' | 'medium' | 'long' | number;
        method?: 'extractive' | 'abstractive_llm';
        modelId?: string;
        providerId?: string;
    };
    keywordExtraction?: {
        enabled: boolean;
        maxKeywords?: number;
    };
}
/**
 * Configuration for the persona's memory systems.
 * @interface PersonaMemoryConfig
 */
export interface PersonaMemoryConfig {
    enabled: boolean;
    conversationContext?: PersonaConversationContextConfig;
    ragConfig?: {
        enabled: boolean;
        defaultRetrievalStrategy?: 'similarity' | 'mmr' | 'hybrid_search';
        defaultRetrievalTopK?: number;
        dataSources?: PersonaRagDataSourceConfig[];
        rerankerConfig?: {
            enabled: boolean;
            provider: 'cohere' | 'jina' | 'custom_llm' | string;
            modelName?: string;
            apiKeyEnvVar?: string;
            topN?: number;
        };
        queryAugmentationPromptName?: string;
        resultSynthesizerPromptName?: string;
        retrievedContextProcessing?: PersonaUtilityProcessingConfig;
        retrievalTriggers?: PersonaRagConfigRetrievalTrigger;
        ingestionTriggers?: PersonaRagConfigIngestionTrigger;
        ingestionProcessing?: PersonaRagIngestionProcessingConfig;
        defaultIngestionDataSourceId?: string;
    };
    workingMemoryProcessing?: {
        adaptationRules?: Array<{
            triggerEvent: string;
            action: 'update_trait' | 'log_preference' | 'trigger_self_reflection' | string;
            parameters?: any;
            processingEngine?: PersonaUtilityProcessingConfig;
        }>;
    };
    lifecycleConfig?: {
        negotiationEnabled?: boolean;
    };
}
/**
 * Configuration for sentiment-aware metaprompt tracking.
 * Controls whether the GMI analyzes user sentiment and triggers
 * event-based metaprompts in response to detected emotional states.
 *
 * @interface SentimentTrackingConfig
 *
 * @example
 * // Minimal: enable with defaults
 * sentimentTracking: { enabled: true }
 *
 * @example
 * // Full: LLM-based analysis with custom thresholds
 * sentimentTracking: {
 *   enabled: true,
 *   method: 'llm',
 *   historyWindow: 10,
 *   frustrationThreshold: -0.3,
 *   satisfactionThreshold: 0.3,
 *   consecutiveTurnsForTrigger: 2,
 *   presets: ['frustration_recovery', 'confusion_clarification'],
 * }
 */
export interface SentimentTrackingConfig {
    /**
     * Master switch: enables/disables sentiment analysis on user input.
     * When false (default), no sentiment analysis runs and no events are emitted.
     * Turn_interval metaprompts (like gmi_self_trait_adjustment) still work regardless.
     * @default false
     */
    enabled: boolean;
    /**
     * Sentiment analysis method.
     * - 'lexicon_based': Fast (~10-50ms), no LLM cost, basic accuracy (VADER-style)
     * - 'llm': Uses LLM call, higher accuracy, ~500-1000ms latency, costs tokens
     * - 'trained_classifier': Uses trained ML model (if available)
     * @default 'lexicon_based'
     */
    method?: 'lexicon_based' | 'llm' | 'trained_classifier';
    /**
     * Model ID for LLM-based or trained_classifier methods.
     * Falls back to persona defaultModelId if not specified.
     */
    modelId?: string;
    /**
     * Provider ID for LLM-based methods.
     * Falls back to persona defaultProviderId if not specified.
     */
    providerId?: string;
    /**
     * Number of recent turns to keep in sentiment history (sliding window).
     * Higher = better pattern detection, slightly more memory.
     * @default 10
     */
    historyWindow?: number;
    /**
     * Sentiment score threshold below which frustration is detected.
     * Score range: -1 (very negative) to 1 (very positive).
     * @default -0.3
     */
    frustrationThreshold?: number;
    /**
     * Sentiment score threshold above which satisfaction is detected.
     * @default 0.3
     */
    satisfactionThreshold?: number;
    /**
     * Number of consecutive turns with same sentiment pattern before triggering event.
     * Prevents over-triggering on single outlier messages.
     * @default 2
     */
    consecutiveTurnsForTrigger?: number;
    /**
     * Which preset metaprompts to enable. Options:
     * - 'frustration_recovery': Responds to user frustration
     * - 'confusion_clarification': Responds to user confusion
     * - 'satisfaction_reinforcement': Responds to user satisfaction
     * - 'error_recovery': Responds to error accumulation
     * - 'engagement_boost': Responds to low engagement
     * - 'all': Enables all presets
     *
     * Only listed presets will be merged. Omit to enable none (use custom metaPrompts instead).
     * @default [] (no presets auto-merged)
     */
    presets?: Array<'frustration_recovery' | 'confusion_clarification' | 'satisfaction_reinforcement' | 'error_recovery' | 'engagement_boost' | 'all'>;
}
/**
 * Defines a meta-prompt for GMI self-regulation.
 * @interface MetaPromptDefinition
 */
export interface MetaPromptDefinition {
    id: string;
    description?: string;
    promptTemplate: string | {
        template: string;
        variables?: string[];
    };
    modelId?: string;
    providerId?: string;
    maxOutputTokens?: number;
    temperature?: number;
    outputSchema?: Record<string, any>;
    trigger?: {
        type: 'turn_interval';
        intervalTurns: number;
    } | {
        type: 'event_based';
        eventName: string;
    } | {
        type: 'manual';
    };
}
/**
 * Defines contextual elements that can be dynamically injected into prompts.
 * @interface ContextualPromptElement
 */
export interface ContextualPromptElement {
    id: string;
    type: string;
    content: string | object;
    criteria: ContextualPromptElementCriteria;
    priority?: number;
    metadata?: Record<string, any>;
}
/**
 * Defines criteria for activating a contextual prompt element.
 * @interface ContextualPromptElementCriteria
 */
export interface ContextualPromptElementCriteria {
    [key: string]: any;
}
/**
 * The primary interface defining a complete Persona for a Generalized Mind Instance (GMI).
 * @interface IPersonaDefinition
 */
export interface IPersonaDefinition {
    /** Stable unique identifier for the persona (used for activation & persistence). */
    id: string;
    /** Human-readable name surfaced in UI selection lists. */
    name: string;
    /** Optional short label (e.g., abbreviation) for compact UI contexts. */
    label?: string;
    /** Rich description of goals, domain focus, and behavioral nuance. */
    description: string;
    /** Semantic version of persona definition; bump on behavioral / config changes (e.g., '1.2.0'). */
    version: string;
    /**
     * Base system prompt (or structured template) establishing foundational directives.
     * Supports:
     *  - Raw string
     *  - Templated object { template, variables[] }
     *  - Ordered array of prompt fragments with priority for deterministic merging.
     */
    baseSystemPrompt: string | {
        template: string;
        variables?: string[];
    } | Array<{
        content: string;
        priority?: number;
    }>;
    /** Default model id to target for this persona's typical tasks (can be routed or overridden). */
    defaultModelId?: string;
    /** Preferred provider if same model family exists across vendors (helps routing heuristics). */
    defaultProviderId?: string;
    /** Baseline completion option overrides (temperature, maxTokens, presence penalties, etc.). */
    defaultModelCompletionOptions?: Partial<ModelCompletionOptions>;
    /** Ordered preferences describing desired model traits (cost/perf/latency) for dynamic selection. */
    modelTargetPreferences?: ModelTargetPreference[];
    /** High-level cost strategy guiding router decisions. */
    costSavingStrategy?: 'always_cheapest' | 'balance_quality_cost' | 'prioritize_quality' | 'user_preference';
    /** Partial overrides merged onto global PromptEngine configuration for persona specialization. */
    promptEngineConfigOverrides?: Partial<PromptEngineConfig>;
    /** Referenced tool identifiers persona is permitted to invoke. */
    toolIds?: string[];
    /** Abstract capability flags enabling conditional UI / workflow features (e.g., 'web_search'). */
    allowedCapabilities?: string[];
    /** Inline tool instances embedded directly (rare; typically tools live in registry). */
    embeddedTools?: ITool[];
    /** Whitelisted input modalities persona accepts (driver for validation in interaction layer). */
    allowedInputModalities?: Array<'text' | 'audio_transcription' | 'vision_image_url' | 'vision_image_base64'>;
    /** Output modalities persona can produce (text, TTS synthesized, image generation results). */
    allowedOutputModalities?: Array<'text' | 'audio_tts' | 'image_generation_tool_result'>;
    /** Voice synthesis configuration (preferred voice id, style, speed). */
    voiceConfig?: PersonaVoiceConfig;
    /** Visual avatar / representation metadata (image URL, animation style). */
    avatarConfig?: PersonaAvatarConfig;
    /** Arbitrary personality trait map (e.g., { humor_level: 0.7, pedagogical_style: 'socratic' }). */
    personalityTraits?: Record<string, any>;
    /** Rules controlling adaptive mood shifts & modulation of tone. */
    moodAdaptation?: PersonaMoodAdaptationConfig;
    /** Default output language (BCP‑47) used when user preference unspecified. */
    defaultLanguage?: string;
    /** High-level interaction posture for UI behaviors (suggestive hints vs directive instructions). */
    uiInteractionStyle?: 'suggestive' | 'directive' | 'collaborative' | 'silent';
    /** Memory subsystem tuning (retention horizons, summarization cadence, pinning rules). */
    memoryConfig?: PersonaMemoryConfig;
    /** Conversation context override strategy (message importance heuristics, summarization triggers). */
    conversationContextConfig?: PersonaConversationContextConfig;
    /** System or self-reflective prompts guiding meta-cognition, self-correction, or planning loops. */
    metaPrompts?: MetaPromptDefinition[];
    /**
     * Sentiment tracking configuration. Controls whether the GMI analyzes user emotional state
     * and triggers event-based metaprompts (frustration recovery, confusion clarification, etc.).
     * Opt-in: disabled by default. Turn_interval metaprompts (like self-reflection) always work regardless.
     */
    sentimentTracking?: SentimentTrackingConfig;
    /** Dynamic contextual prompt elements evaluated per turn for fine-grained adaptation. */
    contextualPromptElements?: ContextualPromptElement[];
    /** Allows persona to perform privileged creation/update of other personas. */
    isCreatorPersona?: boolean;
    /** If true persona is globally discoverable subject to subscription tier gating. */
    isPublic?: boolean;
    /** Natural language keywords enabling auto-activation in multi-persona environments. */
    activationKeywords?: string[];
    /** Strength tag list aiding search & recommendation (e.g., ['typescript', 'design_reviews']). */
    strengths?: string[];
    /** Minimum subscription tier required to access persona (e.g., 'pro', 'enterprise'). */
    minSubscriptionTier?: string;
    /** Seed working memory imprints establishing initial context (preferences, calibration data). */
    initialMemoryImprints?: Array<{
        key: string;
        value: any;
        description?: string;
    }>;
    /** Arbitrary extension fields and structured defaults for user/task contexts. */
    customFields?: Record<string, any> & {
        /** Working memory default config attached at GMI instantiation time. */
        defaultWorkingMemoryConfig?: any;
        /** Initial inferred or declared user context values. */
        initialUserContext?: Partial<PersonaUserContextDefaults>;
        /** Initial task framing values (e.g., domain, complexity baseline). */
        initialTaskContext?: Partial<PersonaTaskContextDefaults>;
    };
    /** Named secrets (API keys, credentials) this persona depends on. */
    requiredSecrets?: string[];
}
//# sourceMappingURL=IPersonaDefinition.d.ts.map