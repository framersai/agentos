import type { IPersonaDefinition } from '../personas/IPersonaDefinition';
import type { PersonaEvolutionRule } from '../../core/workflows/WorkflowTypes';

/**
 * Captures the overlay state applied to a persona at runtime.
 */
export interface PersonaStateOverlay {
  personaId: string;
  appliedRules: string[];
  patchedDefinition: Partial<IPersonaDefinition>;
  metadata?: Record<string, unknown>;
}

/**
 * Context supplied when evaluating persona evolution rules.
 */
export interface PersonaEvolutionContext {
  workflowId: string;
  agencyId?: string;
  roleId: string;
  recentOutputs?: Array<{ taskId: string; output: unknown }>;
  reasoningSignals?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ApplyPersonaRulesArgs {
  persona: IPersonaDefinition;
  rules: PersonaEvolutionRule[];
  context: PersonaEvolutionContext;
  previousOverlay?: PersonaStateOverlay;
}
