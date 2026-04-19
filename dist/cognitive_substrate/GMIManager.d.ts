/**
 * @fileoverview This file implements the GMIManager (Generalized Mind Instance Manager),
 * a crucial component in AgentOS responsible for the lifecycle management of GMIs.
 * @module backend/agentos/cognitive_substrate/GMIManager
 */
import { IGMI, GMIBaseConfig } from './IGMI';
import { IPersonaDefinition } from './personas/IPersonaDefinition';
import { PersonaValidationStrictConfig } from './personas/PersonaValidation';
import { IPersonaLoader, PersonaLoaderConfig } from './personas/IPersonaLoader';
import type { IAuthService, ISubscriptionService } from '../types/auth';
import { InMemoryWorkingMemory } from './memory/InMemoryWorkingMemory';
import { ConversationManager } from '../core/conversation/ConversationManager';
import { ConversationContext } from '../core/conversation/ConversationContext';
import { GMIError, GMIErrorCode } from '../core/utils/errors';
import { IPromptEngine } from '../core/llm/IPromptEngine';
import { AIModelProviderManager } from '../core/llm/providers/AIModelProviderManager';
import { IUtilityAI } from '../nlp/ai_utilities/IUtilityAI';
import { IToolOrchestrator } from '../core/tools/IToolOrchestrator';
import { IRetrievalAugmentor } from '../rag/IRetrievalAugmentor';
import type { PersonaStateOverlay, PersonaEvolutionContext } from './persona_overlays/PersonaOverlayTypes';
import type { PersonaEvolutionRule } from '../orchestration/workflows/WorkflowTypes';
import type { ICognitiveMemoryManager } from '../memory/CognitiveMemoryManager.js';
/**
 * Custom error class for GMIManager-specific operational errors.
 */
export declare class GMIManagerError extends GMIError {
    constructor(message: string, code: GMIErrorCode | string, details?: any);
}
/**
 * Configuration options for the GMIManager.
 */
export interface GMIManagerConfig {
    personaLoaderConfig: PersonaLoaderConfig;
    defaultGMIInactivityCleanupMinutes?: number;
    defaultWorkingMemoryType?: 'in_memory' | string;
    defaultGMIBaseConfigDefaults?: Partial<Pick<GMIBaseConfig, 'defaultLlmProviderId' | 'defaultLlmModelId' | 'customSettings'>>;
    /** Strict validation enforcement configuration (optional, defaults to permissive). */
    personaValidationStrict?: PersonaValidationStrictConfig;
    /** Optional per-GMI cognitive memory factory used by devtools and advanced runtimes. */
    cognitiveMemoryFactory?: GMICognitiveMemoryFactory;
}
export interface GMICognitiveMemoryFactoryInput {
    gmiInstanceId: string;
    sessionId: string;
    userId: string;
    persona: IPersonaDefinition;
    workingMemory: InMemoryWorkingMemory;
    llmProviderManager: AIModelProviderManager;
    utilityAI: IUtilityAI;
    toolOrchestrator: IToolOrchestrator;
    retrievalAugmentor?: IRetrievalAugmentor;
}
export type GMICognitiveMemoryFactory = (input: GMICognitiveMemoryFactoryInput) => Promise<ICognitiveMemoryManager | undefined> | ICognitiveMemoryManager | undefined;
/**
 * Options supplied when instantiating a GMI for an Agency seat.
 */
export interface GMIAgencyContextOptions {
    agencyId: string;
    roleId: string;
    workflowId?: string;
    evolutionRules?: PersonaEvolutionRule[];
    evolutionContext?: PersonaEvolutionContext;
}
/**
 * Manages the lifecycle of Generalized Mind Instances (GMIs).
 */
export declare class GMIManager {
    private config;
    private personaLoader;
    private allPersonaDefinitions;
    private allPersonaRecords;
    activeGMIs: Map<string, IGMI>;
    gmiSessionMap: Map<string, string>;
    private readonly personaOverlayManager;
    private readonly agencySeatOverlays;
    private authService?;
    private subscriptionService?;
    private conversationManager;
    private promptEngine;
    private llmProviderManager;
    private utilityAI;
    private toolOrchestrator;
    private retrievalAugmentor?;
    private isInitialized;
    readonly managerId: string;
    constructor(config: GMIManagerConfig, subscriptionService: ISubscriptionService | undefined, authService: IAuthService | undefined, conversationManager: ConversationManager, promptEngine: IPromptEngine, llmProviderManager: AIModelProviderManager, utilityAI: IUtilityAI, toolOrchestrator: IToolOrchestrator, retrievalAugmentor?: IRetrievalAugmentor, personaLoader?: IPersonaLoader);
    private validateGMIDependencies;
    private getAgencySeatKey;
    clearAgencyPersonaOverlay(agencyId: string, roleId: string): void;
    getAgencyPersonaOverlay(agencyId: string, roleId: string): PersonaStateOverlay | undefined;
    private resolvePersonaWithAgencyOverlay;
    private resolveUserTier;
    private resolveTierByName;
    private userMeetsPersonaTier;
    initialize(): Promise<void>;
    private ensureInitialized;
    loadAllPersonaDefinitions(): Promise<void>;
    getPersonaDefinition(personaId: string): IPersonaDefinition | undefined;
    listAvailablePersonas(userId?: string): Promise<Partial<IPersonaDefinition>[]>;
    private stripSensitivePersonaData;
    private deriveRequiredSecretsForPersona;
    private assembleGMIBaseConfig;
    getOrCreateGMIForSession(userId: string, sessionId: string, requestedPersonaId: string, conversationIdInput?: string, preferredModelId?: string, preferredProviderId?: string, userApiKeys?: Record<string, string>, agencyOptions?: GMIAgencyContextOptions): Promise<{
        gmi: IGMI;
        conversationContext: ConversationContext;
    }>;
    getGMIByInstanceId(gmiInstanceId: string): IGMI | undefined;
    deactivateGMIForSession(sessionId: string): Promise<boolean>;
    cleanupInactiveGMIs(inactivityThresholdMinutes?: number): Promise<number>;
    shutdown(): Promise<void>;
    processUserFeedback(userId: string, sessionId: string, personaId: string, feedbackData: any): Promise<void>;
    private addTraceEntryToRelevantGMI;
}
//# sourceMappingURL=GMIManager.d.ts.map