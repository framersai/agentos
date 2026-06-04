import { describe, expect, it } from 'vitest';

import type { PersonaEvolutionRule } from '../../src/orchestration/workflows/WorkflowTypes.js';
import { PersonaOverlayManager } from '../../src/cognition/substrate/persona_overlays/PersonaOverlayManager.js';
import type { PersonaEvolutionContext } from '../../src/cognition/substrate/persona_overlays/PersonaOverlayTypes.js';
import type { IPersonaDefinition } from '../../src/cognition/substrate/personas/IPersonaDefinition.js';

class TestOverlayManager extends PersonaOverlayManager {
  protected override shouldApplyRule(): boolean {
    return true;
  }
}

const basePersona: IPersonaDefinition = {
  id: 'persona-test',
  name: 'Test Persona',
  description: 'Base persona',
  version: '1.0.0',
  baseSystemPrompt: '',
};

const rule: PersonaEvolutionRule = {
  id: 'rule-1',
  trigger: 'always',
  patch: {
    mood: 'focused',
    personaTraits: { tone: 'concise' },
    metadata: { overlayApplied: true },
  },
};

const context: PersonaEvolutionContext = {
  workflowId: 'workflow-1',
  roleId: 'architect',
};

describe('PersonaOverlayManager', () => {
  it('applies matching rules and produces overlay', () => {
    const manager = new TestOverlayManager();
    const overlay = manager.applyRules({
      persona: basePersona,
      rules: [rule],
      context,
    });

    expect(overlay.personaId).toBe(basePersona.id);
    expect(overlay.appliedRules).toContain(rule.id);
    expect(overlay.patchedDefinition.moodAdaptation?.defaultMood).toBe('focused');
    expect(overlay.patchedDefinition.personalityTraits?.tone).toBe('concise');
    expect(overlay.patchedDefinition.customFields?.overlayApplied).toBe(true);
  });

  it('merges overlay with persona definition', () => {
    const manager = new PersonaOverlayManager();
    const persona = manager.resolvePersona(basePersona, {
      personaId: basePersona.id,
      appliedRules: ['rule-1'],
      patchedDefinition: {
        personalityTraits: { tone: 'friendly' },
        customFields: { overlayApplied: true },
      },
    });

    expect(persona.customFields?.overlayApplied).toBe(true);
    expect(persona.personalityTraits?.tone).toBe('friendly');
  });
});
