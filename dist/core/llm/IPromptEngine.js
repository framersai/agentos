// File: backend/agentos/core/llm/IPromptEngine.ts
/**
 * @fileoverview Defines the IPromptEngine interface and related types that form the core
 * of AgentOS's adaptive and contextual prompting system. The PromptEngine is responsible
 * for dynamically constructing prompts based on rich contextual information, persona
 * definitions, and runtime state. It supports contextual element selection, token budgeting,
 * content summarization, and multiple prompt template formats.
 *
 * This interface is central to the GMI (Generalized Mind Instance) architecture, enabling
 * sophisticated prompt adaptation based on user skill level, mood, task complexity,
 * conversation state, and persona-specific rules.
 *
 * Key responsibilities include:
 * - Dynamic contextual element selection based on PromptExecutionContext.
 * - Intelligent token budgeting and content truncation/summarization using an IUtilityAI helper.
 * - Multi-modal prompt component integration (text, vision, audio data references, tools).
 * - Template-based prompt formatting for different LLM providers and models.
 * - Comprehensive error handling and issue reporting within the PromptEngineResult.
 * - Performance optimization strategies such as caching.
 *
 * @module backend/agentos/core/llm/IPromptEngine
 * See `docs/PROMPTS.MD` for detailed architectural documentation.
 * @see {@link IPersonaDefinition} for persona-driven prompting.
 */
/**
 * Represents different types of contextual prompt elements that can be dynamically
 * selected and integrated into prompts based on execution context.
 * These elements allow for fine-grained adaptation of prompts.
 * @enum {string}
 */
export var ContextualElementType;
(function (ContextualElementType) {
    /** Additional system-level instructions appended to base system prompt. */
    ContextualElementType["SYSTEM_INSTRUCTION_ADDON"] = "system_instruction_addon";
    /** Dynamic few-shot examples selected based on context to guide the LLM. */
    ContextualElementType["FEW_SHOT_EXAMPLE"] = "few_shot_example";
    /** Behavioral guidance or tone adjustments for the persona. */
    ContextualElementType["BEHAVIORAL_GUIDANCE"] = "behavioral_guidance";
    /** Specific instructions or constraints related to the current task. */
    ContextualElementType["TASK_SPECIFIC_INSTRUCTION"] = "task_specific_instruction";
    /** Instructions for handling errors or recovering from unexpected situations. */
    ContextualElementType["ERROR_HANDLING_GUIDANCE"] = "error_handling_guidance";
    /** Adjustments to the GMI's interaction style with the user. */
    ContextualElementType["INTERACTION_STYLE_MODIFIER"] = "interaction_style_modifier";
    /** Domain-specific knowledge, facts, or context relevant to the current query. */
    ContextualElementType["DOMAIN_CONTEXT"] = "domain_context";
    /** Ethical guidelines or safety instructions to ensure responsible AI behavior. */
    ContextualElementType["ETHICAL_GUIDELINE"] = "ethical_guideline";
    /** Specifications for the desired output format (e.g., JSON, Markdown). */
    ContextualElementType["OUTPUT_FORMAT_SPEC"] = "output_format_spec";
    /** Instructions for specific reasoning protocols (e.g., chain-of-thought, tree-of-thought). */
    ContextualElementType["REASONING_PROTOCOL"] = "reasoning_protocol";
    /** Dynamic content to be injected directly into the user part of the prompt. */
    ContextualElementType["USER_PROMPT_AUGMENTATION"] = "user_prompt_augmentation";
    /** Content to be injected into the assistant part for few-shot or role-play setup. */
    ContextualElementType["ASSISTANT_PROMPT_AUGMENTATION"] = "assistant_prompt_augmentation";
})(ContextualElementType || (ContextualElementType = {}));
/**
 * Custom error class for all errors originating from the PromptEngine.
 * This allows for specific catching and handling of prompt construction failures.
 * @class PromptEngineError
 * @extends {Error}
 */
export class PromptEngineError extends Error {
    /**
     * Creates an instance of PromptEngineError.
     * @param {string} message - A human-readable description of the error.
     * @param {string} code - A specific error code (e.g., 'TEMPLATE_NOT_FOUND').
     * @param {string} [component] - The engine component where the error originated.
     * @param {unknown} [details] - Additional context or the underlying error.
     */
    constructor(message, code, component, details) {
        super(message);
        this.name = 'PromptEngineError';
        this.code = code;
        this.component = component;
        this.details = details;
        Object.setPrototypeOf(this, PromptEngineError.prototype); // Ensure instanceof works correctly
    }
}
//# sourceMappingURL=IPromptEngine.js.map