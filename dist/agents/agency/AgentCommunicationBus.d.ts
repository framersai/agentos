/**
 * @file AgentCommunicationBus.ts
 * @description Implementation of the AgentOS Agent Communication Bus.
 * Provides structured messaging between agents within agencies.
 *
 * @module AgentOS/Agency
 * @version 1.0.0
 */
import type { ILogger } from '../../logging/ILogger';
import type { IAgentCommunicationBus, AgentMessage, AgentMessageType, AgentRequest, AgentResponse, HandoffContext, HandoffResult, MessageHandler, Unsubscribe, SubscriptionOptions, MessageTopic, DeliveryStatus, RoutingConfig, BusStatistics } from './IAgentCommunicationBus';
/**
 * Configuration for AgentCommunicationBus.
 */
export interface AgentCommunicationBusConfig {
    /** Logger instance */
    logger?: ILogger;
    /** Routing configuration */
    routingConfig?: Partial<RoutingConfig>;
    /** Maximum messages to keep in history per agent */
    maxHistoryPerAgent?: number;
}
/**
 * Implementation of the Agent Communication Bus.
 *
 * Features:
 * - Point-to-point messaging between agents
 * - Broadcast to agencies
 * - Request-response pattern
 * - Topic-based pub/sub
 * - Task handoff protocol
 * - Message persistence and history
 * - Delivery tracking and retries
 *
 * @implements {IAgentCommunicationBus}
 */
export declare class AgentCommunicationBus implements IAgentCommunicationBus {
    private readonly logger?;
    private readonly routingConfig;
    private readonly maxHistoryPerAgent;
    /** Agent subscriptions */
    private readonly subscriptions;
    /** Topic definitions */
    private readonly topics;
    /** Topic subscriptions */
    private readonly topicSubscriptions;
    /** Message history per agent */
    private readonly messageHistory;
    /** Delivery statuses */
    private readonly deliveryStatuses;
    /** Pending request-response calls */
    private readonly pendingRequests;
    /** Agent to agency mapping for routing */
    private readonly agentToAgency;
    /** Agency role mappings */
    private readonly agencyRoles;
    /** Statistics */
    private stats;
    /**
     * Creates a new AgentCommunicationBus instance.
     *
     * @param config - Bus configuration
     */
    constructor(config?: AgentCommunicationBusConfig);
    /**
     * Sends a message to a specific agent.
     */
    sendToAgent(targetAgentId: string, message: Omit<AgentMessage, 'messageId' | 'toAgentId' | 'sentAt'>): Promise<DeliveryStatus>;
    /**
     * Sends a message to an agent by role.
     */
    sendToRole(agencyId: string, targetRoleId: string, message: Omit<AgentMessage, 'messageId' | 'toRoleId' | 'sentAt'>): Promise<DeliveryStatus>;
    /**
     * Broadcasts a message to all agents in an agency.
     */
    broadcast(agencyId: string, message: Omit<AgentMessage, 'messageId' | 'toAgentId' | 'sentAt'>): Promise<DeliveryStatus[]>;
    /**
     * Broadcasts to specific roles within an agency.
     */
    broadcastToRoles(agencyId: string, roleIds: string[], message: Omit<AgentMessage, 'messageId' | 'sentAt'>): Promise<DeliveryStatus[]>;
    /**
     * Sends a request and waits for a response.
     */
    requestResponse(targetAgentId: string, request: AgentRequest): Promise<AgentResponse>;
    /**
     * Initiates a structured handoff between agents.
     */
    handoff(fromAgentId: string, toAgentId: string, context: HandoffContext): Promise<HandoffResult>;
    /**
     * Subscribes an agent to receive messages.
     */
    subscribe(agentId: string, handler: MessageHandler, options?: SubscriptionOptions): Unsubscribe;
    /**
     * Unsubscribes an agent from all messages.
     */
    unsubscribeAll(agentId: string): void;
    /**
     * Creates a message topic.
     */
    createTopic(topic: Omit<MessageTopic, 'topicId'>): Promise<MessageTopic>;
    /**
     * Publishes a message to a topic.
     */
    publishToTopic(topicId: string, message: Omit<AgentMessage, 'messageId' | 'sentAt'>): Promise<DeliveryStatus[]>;
    /**
     * Subscribes an agent to a topic.
     */
    subscribeToTopic(agentId: string, topicId: string, handler: MessageHandler): Unsubscribe;
    /**
     * Gets the delivery status of a message.
     */
    getDeliveryStatus(messageId: string): Promise<DeliveryStatus | null>;
    /**
     * Acknowledges receipt of a message.
     */
    acknowledgeMessage(messageId: string, agentId: string): Promise<void>;
    /**
     * Retries delivery of a failed message.
     */
    retryDelivery(messageId: string): Promise<DeliveryStatus>;
    /**
     * Gets message bus statistics.
     */
    getStatistics(): BusStatistics;
    /**
     * Gets message history for an agent.
     */
    getMessageHistory(agentId: string, options?: {
        limit?: number;
        since?: Date;
        types?: AgentMessageType[];
        direction?: 'sent' | 'received' | 'both';
    }): Promise<AgentMessage[]>;
    /**
     * Registers an agent with an agency for routing.
     */
    registerAgent(agentId: string, agencyId: string, roleId: string): void;
    /**
     * Unregisters an agent from routing.
     */
    unregisterAgent(agentId: string): void;
    private deliverMessage;
    private resolvePendingRequest;
    private matchesSubscription;
    private meetsMinPriority;
    private addToHistory;
    private getAgentsInAgency;
    private createDeliveredStatus;
    private createFailedDelivery;
    private updateAvgDeliveryTime;
}
//# sourceMappingURL=AgentCommunicationBus.d.ts.map