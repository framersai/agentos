/**
 * @fileoverview Implements a PersonaLoader that reads persona definitions
 * from JSON files within a specified directory. Each .json file in the directory
 * (and its subdirectories, optionally) is expected to contain a valid IPersonaDefinition.
 *
 * @module backend/agentos/cognitive_substrate/personas/PersonaLoader
 * @see ./IPersonaDefinition.ts
 * @see ./IPersonaLoader.ts
 */
import { IPersonaDefinition } from './IPersonaDefinition';
import { IPersonaLoader, PersonaLoaderConfig } from './IPersonaLoader';
/**
 * Configuration specific to the FileSystemPersonaLoader.
 * @interface FileSystemPersonaLoaderConfig
 * @extends {PersonaLoaderConfig}
 */
export interface FileSystemPersonaLoaderConfig extends PersonaLoaderConfig {
    /**
     * The file system path to the directory containing persona definition JSON files.
     * This overrides the generic `personaSource` from `PersonaLoaderConfig`.
     * @type {string}
     */
    personaDefinitionPath: string;
    /**
     * If true, recursively search for .json files in subdirectories.
     * @type {boolean}
     * @optional
     * @default false
     */
    recursiveSearch?: boolean;
    /**
     * File extension to look for (e.g., ".persona.json", ".json").
     * Must include the leading dot.
     * @type {string}
     * @optional
     * @default ".json"
     */
    fileExtension?: string;
}
/**
 * Implements IPersonaLoader to load persona definitions from the file system.
 * Assumes persona definitions are stored as individual JSON files.
 * @class PersonaLoader
 * @implements {IPersonaLoader}
 */
export declare class PersonaLoader implements IPersonaLoader {
    private config;
    private isInitialized;
    private loadedPersonas;
    readonly loaderId: string;
    constructor();
    private ensureInitialized;
    initialize(config: PersonaLoaderConfig): Promise<void>;
    private findPersonaFiles;
    loadPersonaById(personaId: string): Promise<IPersonaDefinition | undefined>;
    loadAllPersonaDefinitions(): Promise<IPersonaDefinition[]>;
    refreshPersonas(): Promise<void>;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=PersonaLoader.d.ts.map