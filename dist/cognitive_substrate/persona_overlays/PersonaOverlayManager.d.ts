import type { IPersonaDefinition } from '../personas/IPersonaDefinition';
import type { PersonaEvolutionRule } from '../../orchestration/workflows/WorkflowTypes';
import { type ApplyPersonaRulesArgs, type PersonaEvolutionContext, type PersonaStateOverlay } from './PersonaOverlayTypes';
/**
 * Applies evolution rules to personas and produces runtime overlays that can be persisted
 * alongside workflow instances.
 */
export declare class PersonaOverlayManager {
    /**
     * Evaluates the supplied rules against the context and returns an updated overlay.
     * @param args - Persona, rules, context, and existing overlay information.
     * @returns Overlay capturing the persona patches that should be applied.
     */
    applyRules(args: ApplyPersonaRulesArgs): PersonaStateOverlay;
    /**
     * Merges the base persona definition with an overlay to produce the effective persona.
     * @param persona - Base persona definition.
     * @param overlay - Overlay generated from applied rules.
     * @returns Persona definition with applied patches.
     */
    resolvePersona(persona: IPersonaDefinition, overlay?: PersonaStateOverlay): IPersonaDefinition;
    /**
     * Determines whether a given rule should be applied. Placeholder implementation that
     * always returns false until a trigger DSL is defined.
     * @param rule - Evolution rule under consideration.
     * @param context - Signals captured during workflow execution.
     * @returns `true` when the rule should be applied.
     */
    protected shouldApplyRule(rule: PersonaEvolutionRule, context: PersonaEvolutionContext): boolean;
    private matchesStringTrigger;
    private readContextValue;
}
//# sourceMappingURL=PersonaOverlayManager.d.ts.map