/**
 * @fileoverview Defines the configuration structure (`AgentPoolConfig`) for an agent
 * that functions as an "Agent Pool". An Agent Pool manages a collection of sub-agents
 * and employs various strategies to coordinate their activities, synthesize their outputs,
 * or route tasks to them. This configuration is typically used within an `AgentConfig`
 * when the agent's type is `AgentType.POOL`.
 *
 * This module also defines the `AgentPoolStrategy` enum, which specifies the
 * operational mode of the pool.
 * @module backend/agentos/agents/definitions/AgentPoolConfig
 */
/**
 * Defines the strategy an Agent Pool uses to interact with its sub-agents
 * and present a unified front or achieve a collective goal.
 * Each strategy dictates how the pool agent selects, delegates to,
 * and processes outputs from its managed sub-agents.
 * @enum {string}
 */
export var AgentPoolStrategy;
(function (AgentPoolStrategy) {
    /**
     * **Unified Persona Routing**: The pool agent maintains a singular, consistent persona
     * to the user. It intelligently routes incoming requests or tasks to the most
     * appropriate sub-agent based on the query content, conversation context, or internal
     * routing logic (which may involve an LLM call). Outputs from the chosen sub-agent
     * are then processed (e.g., rephrased, validated) by the pool agent to ensure
     * they align with the unified persona and overall coherence before being presented to the user.
     */
    AgentPoolStrategy["UNIFIED_PERSONA_ROUTING"] = "unified_persona_routing";
    /**
     * **Mixture of Experts Synthesis**: The pool agent functions as a coordinator for a
     * "mixture of experts." It may consult multiple sub-agents, either simultaneously
     * or sequentially, for a given task. The pool agent then aggregates and synthesizes
     * their individual contributions (which could be text, data, or tool calls) into a
     * single, comprehensive response. The expertise of individual sub-agents might be
     * explicitly acknowledged or subtly integrated into the final output.
     */
    AgentPoolStrategy["MIXTURE_OF_EXPERTS_SYNTHESIS"] = "mixture_of_experts_synthesis";
    /**
     * **Direct Delegation**: The pool agent acts primarily as a simple router or dispatcher.
     * It selects a single sub-agent deemed most suitable for the task and directly
     * forwards that sub-agent's response to the user, potentially with minimal
     * or no post-processing by the pool agent itself. This strategy is useful for
     * clear handoffs to highly specialized sub-agents where the sub-agent's distinct
     * persona or output style is acceptable or desired.
     */
    AgentPoolStrategy["DIRECT_DELEGATION"] = "direct_delegation";
    /**
     * **Exploratory Generation**: The pool agent uses its sub-agents as parallel workers
     * to explore different approaches, generate diverse outputs, or brainstorm solutions
     * for a complex problem. Each sub-agent might tackle the problem from a unique angle
     * or with different constraints. The pool agent then evaluates these varied internal
     * outputs and either selects the "best" one, synthesizes them into a novel solution,
     * or presents a summary of the explorations to the user.
     */
    AgentPoolStrategy["EXPLORATORY_GENERATION"] = "exploratory_generation";
})(AgentPoolStrategy || (AgentPoolStrategy = {}));
//# sourceMappingURL=AgentPoolConfig.js.map