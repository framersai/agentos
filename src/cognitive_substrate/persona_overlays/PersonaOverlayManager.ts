import type { IPersonaDefinition } from '../personas/IPersonaDefinition';
import type { PersonaEvolutionRule } from '../../core/workflows/WorkflowTypes';
import {
  type ApplyPersonaRulesArgs,
  type PersonaEvolutionContext,
  type PersonaStateOverlay,
} from './PersonaOverlayTypes';

/**
 * Applies evolution rules to personas and produces runtime overlays that can be persisted
 * alongside workflow instances.
 */
export class PersonaOverlayManager {
  /**
   * Evaluates the supplied rules against the context and returns an updated overlay.
   * @param args - Persona, rules, context, and existing overlay information.
   * @returns Overlay capturing the persona patches that should be applied.
   */
  public applyRules(args: ApplyPersonaRulesArgs): PersonaStateOverlay {
    const appliedRules: string[] = [];
    const patches: Partial<IPersonaDefinition> = { ...(args.previousOverlay?.patchedDefinition ?? {}) };

    for (const rule of args.rules) {
      if (this.shouldApplyRule(rule, args.context)) {
        appliedRules.push(rule.id);
        if (rule.patch?.personaTraits) {
          patches.personalityTraits = {
            ...(args.persona.personalityTraits ?? {}),
            ...rule.patch.personaTraits,
          };
        }
        if (rule.patch?.mood) {
          const currentMood =
            patches.moodAdaptation ?? args.persona.moodAdaptation ?? {
              enabled: true,
              defaultMood: rule.patch.mood,
            };
          patches.moodAdaptation = {
            ...currentMood,
            enabled: currentMood.enabled ?? true,
            defaultMood: rule.patch.mood,
          };
        }
        if (rule.patch?.metadata) {
          patches.customFields = {
            ...(args.persona.customFields ?? {}),
            ...rule.patch.metadata,
          };
        }
      }
    }

    return {
      personaId: args.persona.id,
      appliedRules: [...new Set([...(args.previousOverlay?.appliedRules ?? []), ...appliedRules])],
      patchedDefinition: patches,
      metadata: args.previousOverlay?.metadata,
    };
  }

  /**
   * Merges the base persona definition with an overlay to produce the effective persona.
   * @param persona - Base persona definition.
   * @param overlay - Overlay generated from applied rules.
   * @returns Persona definition with applied patches.
   */
  public resolvePersona(persona: IPersonaDefinition, overlay?: PersonaStateOverlay): IPersonaDefinition {
    if (!overlay) {
      return persona;
    }
    return {
      ...persona,
      ...overlay.patchedDefinition,
      personalityTraits: {
        ...(persona.personalityTraits ?? {}),
        ...(overlay.patchedDefinition.personalityTraits ?? {}),
      },
      customFields: {
        ...(persona.customFields ?? {}),
        ...(overlay.patchedDefinition.customFields ?? {}),
      },
    };
  }

  /**
   * Determines whether a given rule should be applied. Placeholder implementation that
   * always returns false until a trigger DSL is defined.
   * @param rule - Evolution rule under consideration.
   * @param context - Signals captured during workflow execution.
   * @returns `true` when the rule should be applied.
   */
  protected shouldApplyRule(_rule: PersonaEvolutionRule, _context: PersonaEvolutionContext): boolean {
    // TODO: Evaluate triggers (string DSL or function) to decide applicability.
    return false;
  }
}
