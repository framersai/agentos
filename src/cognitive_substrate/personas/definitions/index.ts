import type { IPersonaDefinition } from '../IPersonaDefinition';

import atlasSystemsArchitect from './atlas_systems_architect.json' with { type: 'json' };
import defaultAssistant from './default_assistant_persona.json' with { type: 'json' };
import defaultFreeAssistant from './default_free_assistant.json' with { type: 'json' };
import nerfGeneralist from './nerf_generalist.json' with { type: 'json' };
import vResearcher from './v_researcher.json' with { type: 'json' };

/**
 * Deeply clones a persona definition to avoid accidental mutation of the
 * source JSON objects bundled with the library.
 */
function clonePersona(definition: IPersonaDefinition): IPersonaDefinition {
  return JSON.parse(JSON.stringify(definition)) as IPersonaDefinition;
}

const BUILT_IN_SOURCES: IPersonaDefinition[] = [
  defaultAssistant as unknown as IPersonaDefinition,
  defaultFreeAssistant as unknown as IPersonaDefinition,
  atlasSystemsArchitect as unknown as IPersonaDefinition,
  nerfGeneralist as unknown as IPersonaDefinition,
  vResearcher as unknown as IPersonaDefinition,
];

/**
 * Canonical catalogue of persona definitions shipped with AgentOS.
 * Consumers can use this list to seed custom loaders or expose the
 * default personas in local-first environments (e.g., the workbench UI).
 */
export const BUILT_IN_PERSONAS: IPersonaDefinition[] = BUILT_IN_SOURCES.map(clonePersona);

/**
 * Returns a cloned persona definition matching the provided identifier.
 *
 * @param personaId - Identifier declared inside the JSON definition.
 */
export function getBuiltInPersona(personaId: string): IPersonaDefinition | undefined {
  const match = BUILT_IN_SOURCES.find((definition) => definition.id === personaId);
  return match ? clonePersona(match) : undefined;
}
