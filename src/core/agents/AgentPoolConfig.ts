/**
 * @fileoverview Defines the configuration structure (`AgentPoolConfig`) for an agent
 * that functions as an "Agent Pool". An Agent Pool manages a collection of sub-agents
 * and employs various strategies to coordinate their activities, synthesize their outputs,
 * or route tasks to them. This configuration is typically used within an `AgentConfig`
 * when the agent's type is `AgentType.POOL`.
 *
 * This module also defines the `AgentPoolStrategy` enum, which specifies the
 * operational mode of the pool.
 * @module backend/agentos/core/agents/AgentPoolConfig
 */

import { ModelTargetInfo } from '../llm/IPromptEngine'; // For model preferences in routing/synthesis
import { ModelCompletionOptions } from '../llm/providers/IProvider';

/**
 * Defines the strategy an Agent Pool uses to interact with its sub-agents
 * and present a unified front or achieve a collective goal.
 * Each strategy dictates how the pool agent selects, delegates to,
 * and processes outputs from its managed sub-agents.
 * @enum {string}
 */
export enum AgentPoolStrategy {
  /**
   * **Unified Persona Routing**: The pool agent maintains a singular, consistent persona
   * to the user. It intelligently routes incoming requests or tasks to the most
   * appropriate sub-agent based on the query content, conversation context, or internal
   * routing logic (which may involve an LLM call). Outputs from the chosen sub-agent
   * are then processed (e.g., rephrased, validated) by the pool agent to ensure
   * they align with the unified persona and overall coherence before being presented to the user.
   */
  UNIFIED_PERSONA_ROUTING = 'unified_persona_routing',

  /**
   * **Mixture of Experts Synthesis**: The pool agent functions as a coordinator for a
   * "mixture of experts." It may consult multiple sub-agents, either simultaneously
   * or sequentially, for a given task. The pool agent then aggregates and synthesizes
   * their individual contributions (which could be text, data, or tool calls) into a
   * single, comprehensive response. The expertise of individual sub-agents might be
   * explicitly acknowledged or subtly integrated into the final output.
   */
  MIXTURE_OF_EXPERTS_SYNTHESIS = 'mixture_of_experts_synthesis',

  /**
   * **Direct Delegation**: The pool agent acts primarily as a simple router or dispatcher.
   * It selects a single sub-agent deemed most suitable for the task and directly
   * forwards that sub-agent's response to the user, potentially with minimal
   * or no post-processing by the pool agent itself. This strategy is useful for
   * clear handoffs to highly specialized sub-agents where the sub-agent's distinct
   * persona or output style is acceptable or desired.
   */
  DIRECT_DELEGATION = 'direct_delegation',

  /**
   * **Exploratory Generation**: The pool agent uses its sub-agents as parallel workers
   * to explore different approaches, generate diverse outputs, or brainstorm solutions
   * for a complex problem. Each sub-agent might tackle the problem from a unique angle
   * or with different constraints. The pool agent then evaluates these varied internal
   * outputs and either selects the "best" one, synthesizes them into a novel solution,
   * or presents a summary of the explorations to the user.
   */
  EXPLORATORY_GENERATION = 'exploratory_generation',
}

/**
 * Configuration options specific to an agent operating as an Agent Pool.
 * This structure is nested within the main `AgentConfig` if the agent type is `POOL`.
 * @interface AgentPoolConfig
 */
export interface AgentPoolConfig {
  /**
   * An array of unique string identifiers for the sub-agents that belong to this pool.
   * These IDs are used by the `AgentFactory` to load and instantiate the actual
   * sub-agent instances managed by this `AgentPoolAgent`.
   * @type {string[]}
   * @example ["coding_expert_agent", "documentation_search_agent"]
   */
  subAgentIds: string[];

  /**
   * The primary strategy this Agent Pool employs for managing its sub-agents
   * and generating its output. The chosen strategy dictates the pool's core logic.
   * @type {AgentPoolStrategy}
   * @see AgentPoolStrategy for detailed explanations of each strategy.
   */
  strategy: AgentPoolStrategy;

  /**
   * Optional. The ID of a globally defined persona configuration (`IPersonaDefinition`)
   * that the entire pool should adopt as its "unified persona". If provided, the pool agent
   * will strive to ensure all its communications align with this persona. This might involve
   * rephrasing sub-agent outputs or providing overarching context. If not provided,
   * sub-agents may retain their individual personas, and the pool agent will focus more
   * on orchestration and synthesis without strict persona enforcement at the pool level.
   * @type {string}
   * @optional
   * @example "chief_ai_officer_persona"
   */
  unifiedPersonaId?: string;

  /**
   * Optional. A system prompt specifically for the Agent Pool's meta-role in orchestrating
   * its sub-agents. This prompt guides the pool agent's internal decision-making processes
   * (e.g., how to route tasks, when to synthesize, how to manage sub-agent interactions).
   * This is distinct from the `unifiedPersonaId` (which defines user-facing persona)
   * and the `systemPrompt` of the `AgentPoolAgent` itself (which might be more general).
   * @type {string}
   * @optional
   * @example "You are a lead architect managing a team of specialist AI engineers. Your goal is to select the best engineer for each task and ensure their responses are concise, accurate, and actionable."
   */
  poolSystemPrompt?: string;

  /**
   * Optional. Configuration for how the pool agent performs internal routing or
   * selection of sub-agents, particularly relevant for `UNIFIED_PERSONA_ROUTING`
   * or `DIRECT_DELEGATION` strategies if complex selection logic is needed beyond simple rules.
   * @type {object}
   * @optional
   */
  routingConfig?: {
    /**
     * ID of a specific `IModelRouter` instance (if multiple are available) to be used
     * by the pool agent for its internal sub-agent selection LLM calls.
     * @type {string}
     * @optional
     */
    modelRouterId?: string;

    /**
     * ID of an `IUtilityAI` service instance that might be used for classifying user
     * intent to aid in sub-agent selection, or for scoring sub-agent relevance.
     * @type {string}
     * @optional
     */
    utilityAIForSelectionId?: string;

    /**
     * A high-level strategy for how sub-agents are selected if not explicitly routed by an LLM.
     * 'auto': Default, typically relies on LLM-based routing if `poolSystemPrompt` is defined.
     * 'round_robin': Cycle through sub-agents (simple load distribution).
     * 'relevance_scoring': A more complex method perhaps using embeddings or keyword matching against sub-agent descriptions (requires further implementation).
     * @type {'auto' | 'round_robin' | 'relevance_scoring' | string}
     * @optional
     */
    selectionLogic?: 'auto' | 'round_robin' | 'relevance_scoring' | string; // string for extensibility

    /**
     * `ModelTargetInfo` to guide the selection of an LLM specifically for the pool agent's
     * internal routing decisions (if it uses an LLM for this purpose).
     * @type {ModelTargetInfo}
     * @optional
     */
    selectionModelTargetInfo?: ModelTargetInfo;

    /**
     * Optional overrides for routing-specific LLM completion options (temperature, maxTokens, etc.).
     * @type {Partial<ModelCompletionOptions>}
     * @optional
     */
    selectionCompletionOptions?: Partial<ModelCompletionOptions>;
  };

  /**
   * Optional. Configuration for how the pool agent synthesizes outputs from multiple sub-agents.
   * This is particularly applicable to strategies like `MIXTURE_OF_EXPERTS_SYNTHESIS`
   * and `EXPLORATORY_GENERATION`.
   * @type {object}
   * @optional
   */
  synthesisConfig?: {
    /**
     * The method used for synthesizing multiple sub-agent outputs.
     * 'summarize_and_integrate': Concatenate outputs and ask an LLM to summarize/integrate.
     * 'rank_and_select': Use an LLM or heuristic to rank outputs and select the best one(s).
     * 'hybrid_llm_synthesis': A more complex LLM-driven synthesis process with specific instructions.
     * @type {'summarize_and_integrate' | 'rank_and_select' | 'hybrid_llm_synthesis' | string}
     */
    method: 'summarize_and_integrate' | 'rank_and_select' | 'hybrid_llm_synthesis' | string; // string for extensibility

    /**
     * `ModelTargetInfo` to guide the selection of an LLM specifically for the pool agent's
     * synthesis tasks (if it uses an LLM for this purpose).
     * @type {ModelTargetInfo}
     * @optional
     */
    synthesisModelTargetInfo?: ModelTargetInfo;

    /**
     * Optional prompt template name or direct prompt content to guide the synthesis LLM.
     * @type {string}
     * @optional
     */
    synthesisPrompt?: string;

    /**
     * Optional overrides for synthesis-specific LLM completion options.
     * @type {Partial<ModelCompletionOptions>}
     * @optional
     */
    synthesisCompletionOptions?: Partial<ModelCompletionOptions>;
  };

  /**
   * Any other pool-specific custom settings.
   * @type {{ [key: string]: any }}
   * @optional
   */
  [key: string]: any;
}
