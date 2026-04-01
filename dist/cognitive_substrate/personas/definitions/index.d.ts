import type { IPersonaDefinition } from '../IPersonaDefinition';
/**
 * Canonical catalogue of persona definitions shipped with AgentOS.
 * Consumers can use this list to seed custom loaders or expose the
 * default personas in local-first environments (e.g., the workbench UI).
 */
export declare const BUILT_IN_PERSONAS: IPersonaDefinition[];
/**
 * Returns a cloned persona definition matching the provided identifier.
 *
 * @param personaId - Identifier declared inside the JSON definition.
 */
export declare function getBuiltInPersona(personaId: string): IPersonaDefinition | undefined;
//# sourceMappingURL=index.d.ts.map