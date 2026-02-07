/**
 * @fileoverview Metaprompt Presets - Pre-configured metaprompts for common scenarios
 * @module @framers/agentos/cognitive_substrate/personas/metaprompt_presets
 *
 * Provides 5 preset metaprompt configurations that respond to user emotional states:
 * 1. gmi_frustration_recovery - Responds to frustrated users
 * 2. gmi_confusion_clarification - Responds to confused users
 * 3. gmi_satisfaction_reinforcement - Responds to satisfied users
 * 4. gmi_error_recovery - Responds to error accumulation
 * 5. gmi_engagement_boost - Responds to low engagement
 */

import type { MetaPromptDefinition } from './IPersonaDefinition.js';
import { GMIEventType } from '../GMIEvent.js';

/**
 * Preset: Frustration Recovery
 *
 * Triggered when: User shows frustration (negative sentiment with high intensity)
 * Actions: Switch to empathetic mood, simplify approach, offer alternatives
 */
export const METAPROMPT_FRUSTRATION_RECOVERY: MetaPromptDefinition = {
  id: 'gmi_frustration_recovery',
  description: 'Responds to user frustration by simplifying approach and showing empathy',
  promptTemplate: `You are experiencing a situation where the user appears frustrated. Analyze the evidence and decide how to adjust your approach.

**Current State:**
- Current Mood: {{current_mood}}
- User Skill Level: {{user_skill}}
- Task Complexity: {{task_complexity}}
- User Sentiment: {{current_sentiment}}
- Sentiment Score: {{sentiment_score}}
- Consecutive Frustration Turns: {{consecutive_frustration}}

**Recent Conversation:**
{{recent_conversation}}

**Recent Errors (if any):**
{{recent_errors}}

**Your Task:**
Analyze why the user might be frustrated and recommend adjustments:

1. Should you switch to a more empathetic mood?
2. Should you simplify the task complexity or adjust your explanations?
3. Should you lower the assumed user skill level?
4. What specific strategy would help recover from this situation?

Output JSON with:
- updatedGmiMood: Recommended mood (e.g., "empathetic", "helpful", "patient")
- updatedUserSkillLevel: Adjusted skill level if needed (e.g., "beginner", "intermediate")
- updatedTaskComplexity: Adjusted complexity if needed (e.g., "simple", "moderate")
- adjustmentRationale: Brief explanation (1-2 sentences)
- recoveryStrategy: Specific actions to take (e.g., "break down into smaller steps", "provide concrete example")
- newMemoryImprints: Array of memory updates (optional)`,

  modelId: undefined, // Use persona default
  providerId: undefined,
  maxOutputTokens: 512,
  temperature: 0.3, // Low temperature for consistent, thoughtful adjustments

  outputSchema: {
    type: 'object',
    properties: {
      updatedGmiMood: {
        type: 'string',
        enum: ['neutral', 'focused', 'empathetic', 'curious', 'analytical', 'creative', 'assertive', 'frustrated', 'helpful', 'patient'],
      },
      updatedUserSkillLevel: {
        type: 'string',
        enum: ['novice', 'beginner', 'intermediate', 'advanced', 'expert'],
      },
      updatedTaskComplexity: {
        type: 'string',
        enum: ['simple', 'moderate', 'complex', 'advanced'],
      },
      adjustmentRationale: { type: 'string' },
      recoveryStrategy: { type: 'string' },
      newMemoryImprints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: {},
            description: { type: 'string' },
          },
          required: ['key', 'value'],
        },
      },
    },
    required: ['adjustmentRationale', 'recoveryStrategy'],
  },

  trigger: {
    type: 'event_based',
    eventName: GMIEventType.USER_FRUSTRATED,
  },
};

/**
 * Preset: Confusion Clarification
 *
 * Triggered when: User shows confusion (confusion keywords or neutral with negative signals)
 * Actions: Rephrase, clarify assumptions, provide examples
 */
export const METAPROMPT_CONFUSION_CLARIFICATION: MetaPromptDefinition = {
  id: 'gmi_confusion_clarification',
  description: 'Responds to user confusion by clarifying and rephrasing',
  promptTemplate: `The user appears confused about something. Analyze the situation and recommend clarification strategies.

**Current State:**
- Current Mood: {{current_mood}}
- User Skill Level: {{user_skill}}
- Task Complexity: {{task_complexity}}
- User Sentiment: {{current_sentiment}}
- Consecutive Confusion Turns: {{consecutive_confusion}}

**Recent Conversation:**
{{recent_conversation}}

**Confusion Indicators:**
{{confusion_keywords}}

**Your Task:**
Determine what might be causing confusion and how to clarify:

1. Should you adjust your mood to be more analytical or helpful?
2. Is the task complexity too high for the user's skill level?
3. What clarification strategy would work best?
4. Should you provide concrete examples or analogies?

Output JSON with:
- updatedGmiMood: Recommended mood (e.g., "analytical", "helpful", "patient")
- updatedTaskComplexity: Adjusted complexity if needed
- adjustmentRationale: Brief explanation
- clarificationStrategy: Specific approach (e.g., "provide concrete example", "rephrase using simpler terms", "break down into steps")
- newMemoryImprints: Array of memory updates (optional)`,

  modelId: undefined,
  providerId: undefined,
  maxOutputTokens: 512,
  temperature: 0.3,

  outputSchema: {
    type: 'object',
    properties: {
      updatedGmiMood: {
        type: 'string',
        enum: ['neutral', 'focused', 'empathetic', 'curious', 'analytical', 'creative', 'assertive', 'helpful', 'patient'],
      },
      updatedTaskComplexity: {
        type: 'string',
        enum: ['simple', 'moderate', 'complex', 'advanced'],
      },
      adjustmentRationale: { type: 'string' },
      clarificationStrategy: { type: 'string' },
      newMemoryImprints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: {},
            description: { type: 'string' },
          },
          required: ['key', 'value'],
        },
      },
    },
    required: ['adjustmentRationale', 'clarificationStrategy'],
  },

  trigger: {
    type: 'event_based',
    eventName: GMIEventType.USER_CONFUSED,
  },
};

/**
 * Preset: Satisfaction Reinforcement
 *
 * Triggered when: User shows satisfaction (positive sentiment with high intensity)
 * Actions: Increase complexity, maintain engagement, build on success
 */
export const METAPROMPT_SATISFACTION_REINFORCEMENT: MetaPromptDefinition = {
  id: 'gmi_satisfaction_reinforcement',
  description: 'Responds to user satisfaction by maintaining engagement and potentially increasing complexity',
  promptTemplate: `The user appears satisfied with the current interaction. Determine how to maintain and build on this positive momentum.

**Current State:**
- Current Mood: {{current_mood}}
- User Skill Level: {{user_skill}}
- Task Complexity: {{task_complexity}}
- User Sentiment: {{current_sentiment}}
- Sentiment Score: {{sentiment_score}}
- Consecutive Satisfaction Turns: {{consecutive_satisfaction}}

**Recent Conversation:**
{{recent_conversation}}

**Your Task:**
Decide how to leverage this positive state:

1. Should you increase task complexity to keep the user challenged?
2. Should you upgrade the assumed user skill level?
3. Should you maintain current mood or shift to something more creative/curious?
4. What strategy will maintain engagement without overwhelming?

Output JSON with:
- updatedGmiMood: Recommended mood (e.g., "curious", "creative", "focused")
- updatedUserSkillLevel: Potentially upgraded skill level
- updatedTaskComplexity: Potentially increased complexity
- adjustmentRationale: Brief explanation
- engagementStrategy: How to maintain momentum (e.g., "introduce advanced concepts", "suggest related challenges")
- newMemoryImprints: Array of memory updates (optional)`,

  modelId: undefined,
  providerId: undefined,
  maxOutputTokens: 512,
  temperature: 0.3,

  outputSchema: {
    type: 'object',
    properties: {
      updatedGmiMood: {
        type: 'string',
        enum: ['neutral', 'focused', 'empathetic', 'curious', 'analytical', 'creative', 'assertive', 'helpful'],
      },
      updatedUserSkillLevel: {
        type: 'string',
        enum: ['novice', 'beginner', 'intermediate', 'advanced', 'expert'],
      },
      updatedTaskComplexity: {
        type: 'string',
        enum: ['simple', 'moderate', 'complex', 'advanced'],
      },
      adjustmentRationale: { type: 'string' },
      engagementStrategy: { type: 'string' },
      newMemoryImprints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: {},
            description: { type: 'string' },
          },
          required: ['key', 'value'],
        },
      },
    },
    required: ['adjustmentRationale', 'engagementStrategy'],
  },

  trigger: {
    type: 'event_based',
    eventName: GMIEventType.USER_SATISFIED,
  },
};

/**
 * Preset: Error Recovery
 *
 * Triggered when: Multiple errors occur in recent turns
 * Actions: Analyze error patterns, adjust approach, implement mitigation
 */
export const METAPROMPT_ERROR_RECOVERY: MetaPromptDefinition = {
  id: 'gmi_error_recovery',
  description: 'Responds to error accumulation by analyzing patterns and adjusting approach',
  promptTemplate: `Multiple errors have occurred in recent turns. Analyze the error pattern and recommend adjustments.

**Current State:**
- Current Mood: {{current_mood}}
- User Skill Level: {{user_skill}}
- Task Complexity: {{task_complexity}}

**Recent Errors:**
{{recent_errors}}

**Recent Conversation:**
{{recent_conversation}}

**Your Task:**
Analyze the error pattern and recommend mitigation:

1. What is causing these errors? (complexity mismatch, tool issues, misunderstanding, etc.)
2. Should you adjust your mood to be more analytical or focused?
3. Should you simplify the approach or task complexity?
4. What specific mitigation strategy would help?

Output JSON with:
- updatedGmiMood: Recommended mood (e.g., "analytical", "focused", "careful")
- updatedTaskComplexity: Adjusted complexity if needed
- adjustmentRationale: Brief explanation of error pattern
- mitigationStrategy: Specific actions (e.g., "validate inputs more carefully", "break down into smaller steps", "clarify requirements")
- newMemoryImprints: Array of memory updates (optional)`,

  modelId: undefined,
  providerId: undefined,
  maxOutputTokens: 512,
  temperature: 0.3,

  outputSchema: {
    type: 'object',
    properties: {
      updatedGmiMood: {
        type: 'string',
        enum: ['neutral', 'focused', 'analytical', 'careful', 'helpful'],
      },
      updatedTaskComplexity: {
        type: 'string',
        enum: ['simple', 'moderate', 'complex', 'advanced'],
      },
      adjustmentRationale: { type: 'string' },
      mitigationStrategy: { type: 'string' },
      newMemoryImprints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: {},
            description: { type: 'string' },
          },
          required: ['key', 'value'],
        },
      },
    },
    required: ['adjustmentRationale', 'mitigationStrategy'],
  },

  trigger: {
    type: 'event_based',
    eventName: GMIEventType.ERROR_THRESHOLD_EXCEEDED,
  },
};

/**
 * Preset: Engagement Boost
 *
 * Triggered when: Low engagement detected (consecutive neutral sentiment with short responses)
 * Actions: Inject creativity, change mood, ask engaging questions
 */
export const METAPROMPT_ENGAGEMENT_BOOST: MetaPromptDefinition = {
  id: 'gmi_engagement_boost',
  description: 'Responds to low engagement by injecting creativity and changing approach',
  promptTemplate: `User engagement appears low (consecutive neutral sentiment with minimal responses). Determine how to re-engage.

**Current State:**
- Current Mood: {{current_mood}}
- User Skill Level: {{user_skill}}
- Task Complexity: {{task_complexity}}
- Consecutive Neutral Turns: {{consecutive_neutral}}

**Recent Conversation:**
{{recent_conversation}}

**Your Task:**
Decide how to re-engage the user:

1. Should you switch to a more creative or curious mood?
2. Should you adjust task complexity (might be too simple or too complex)?
3. What engagement strategy would work best?
4. Should you ask thought-provoking questions or introduce interesting variations?

Output JSON with:
- updatedGmiMood: Recommended mood (e.g., "creative", "curious", "engaging")
- updatedTaskComplexity: Adjusted complexity if needed
- adjustmentRationale: Brief explanation
- engagementStrategy: Specific actions (e.g., "ask thought-provoking questions", "introduce interesting variations", "make it more interactive")
- newMemoryImprints: Array of memory updates (optional)`,

  modelId: undefined,
  providerId: undefined,
  maxOutputTokens: 512,
  temperature: 0.5, // Slightly higher temperature for more creative suggestions

  outputSchema: {
    type: 'object',
    properties: {
      updatedGmiMood: {
        type: 'string',
        enum: ['neutral', 'curious', 'creative', 'engaging', 'playful', 'enthusiastic'],
      },
      updatedTaskComplexity: {
        type: 'string',
        enum: ['simple', 'moderate', 'complex', 'advanced'],
      },
      adjustmentRationale: { type: 'string' },
      engagementStrategy: { type: 'string' },
      newMemoryImprints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: {},
            description: { type: 'string' },
          },
          required: ['key', 'value'],
        },
      },
    },
    required: ['adjustmentRationale', 'engagementStrategy'],
  },

  trigger: {
    type: 'event_based',
    eventName: GMIEventType.LOW_ENGAGEMENT,
  },
};

/**
 * All preset metaprompts in a single array.
 * Makes it easy to iterate or merge with persona-specific metaprompts.
 */
export const ALL_METAPROMPT_PRESETS: MetaPromptDefinition[] = [
  METAPROMPT_FRUSTRATION_RECOVERY,
  METAPROMPT_CONFUSION_CLARIFICATION,
  METAPROMPT_SATISFACTION_REINFORCEMENT,
  METAPROMPT_ERROR_RECOVERY,
  METAPROMPT_ENGAGEMENT_BOOST,
];

/**
 * Merges preset metaprompts with persona-specific metaprompts.
 *
 * Persona-defined metaprompts take precedence over presets when IDs match.
 * This allows personas to override preset behavior for specific scenarios.
 *
 * @param personaMetaPrompts - Metaprompts defined in persona configuration
 * @param includePresets - Which presets to include (default: all)
 * @returns Merged array of metaprompts with persona overrides applied
 *
 * @example
 * ```typescript
 * const mergedMetaPrompts = mergeMetapromptPresets(
 *   persona.metaPrompts,
 *   ['gmi_frustration_recovery', 'gmi_confusion_clarification']
 * );
 * ```
 */
export function mergeMetapromptPresets(
  personaMetaPrompts: MetaPromptDefinition[] = [],
  includePresets?: string[]
): MetaPromptDefinition[] {
  // Filter presets if specific ones are requested
  const presetsToInclude = includePresets
    ? ALL_METAPROMPT_PRESETS.filter((preset) => includePresets.includes(preset.id))
    : ALL_METAPROMPT_PRESETS;

  // Create a map of persona metaprompts by ID for quick lookup
  const personaMap = new Map(
    personaMetaPrompts.map((mp) => [mp.id, mp])
  );

  // Merge: persona metaprompts override presets
  const mergedMap = new Map<string, MetaPromptDefinition>();

  // Add all presets first
  for (const preset of presetsToInclude) {
    mergedMap.set(preset.id, preset);
  }

  // Override with persona-specific metaprompts
  for (const personaMetaPrompt of personaMetaPrompts) {
    mergedMap.set(personaMetaPrompt.id, personaMetaPrompt);
  }

  return Array.from(mergedMap.values());
}

/**
 * Gets a preset metaprompt by ID.
 *
 * @param id - Metaprompt ID
 * @returns Preset metaprompt or undefined if not found
 */
export function getPresetMetaprompt(id: string): MetaPromptDefinition | undefined {
  return ALL_METAPROMPT_PRESETS.find((preset) => preset.id === id);
}

/**
 * Checks if a metaprompt ID is a preset.
 *
 * @param id - Metaprompt ID to check
 * @returns True if the ID matches a preset
 */
export function isPresetMetaprompt(id: string): boolean {
  return ALL_METAPROMPT_PRESETS.some((preset) => preset.id === id);
}
