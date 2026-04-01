/**
 * @file IAgentCommunicationBus.ts
 * @description Interface for inter-agent communication within AgentOS agencies.
 * Enables GMIs to send messages, broadcast to agencies, and coordinate tasks.
 *
 * Supports multiple communication patterns:
 * - Point-to-point messaging
 * - Broadcast to agency
 * - Request-response
 * - Task delegation and handoff
 * - Pub/sub for topics
 *
 * @module AgentOS/Agency
 * @version 1.0.0
 *
 * @example
 * ```typescript
 * const bus = new AgentCommunicationBus(logger);
 *
 * // Subscribe to messages
 * const unsubscribe = bus.subscribe('agent-1', (message) => {
 *   console.log('Received:', message);
 * });
 *
 * // Send a message
 * await bus.sendToAgent('agent-2', {
 *   type: 'task_delegation',
 *   content: 'Please analyze this data',
 *   metadata: { priority: 'high' },
 * });
 *
 * // Request-response
 * const response = await bus.requestResponse('agent-3', {
 *   type: 'question',
 *   content: 'What is your analysis?',
 * });
 * ```
 */
export {};
//# sourceMappingURL=IAgentCommunicationBus.js.map