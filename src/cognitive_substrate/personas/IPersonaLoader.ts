/**
 * @fileoverview Defines the IPersonaLoader interface, responsible for loading
 * persona definitions from a specified source. This abstraction allows for
 * different loading strategies, such as from a file system, a database,
 * or a remote configuration service.
 * @module backend/agentos/cognitive_substrate/personas/IPersonaLoader
 */

import { IPersonaDefinition } from './IPersonaDefinition';

/**
 * Configuration for the PersonaLoader.
 * @interface PersonaLoaderConfig
 */
export interface PersonaLoaderConfig {
  /**
   * The source from which to load persona definitions.
   * This could be a file system path, a database connection string, an API endpoint, etc.
   * The interpretation of this field is up to the implementing class.
   * @example "./personas" (for file system loading)
   * @example "mongodb://localhost:27017/personas" (for database loading)
   * @type {string}
   */
  personaSource: string;

  /**
   * Optional: Specifies the type of loader to use, if multiple strategies are supported
   * by a factory or a more complex loader implementation.
   * @type {string}
   * @optional
   * @example "file_system", "database", "http_endpoint"
   */
  loaderType?: string;

  /**
   * Optional: Additional configuration parameters specific to the loader type.
   * @type {Record<string, any>}
   * @optional
   */
  options?: Record<string, any>;
}

/**
 * Defines the contract for a service that loads persona definitions.
 * Implementations are responsible for retrieving persona configuration data
 * and transforming it into valid IPersonaDefinition objects.
 * @interface IPersonaLoader
 */
export interface IPersonaLoader {
  /**
   * Initializes the persona loader with the given configuration.
   * @async
   * @param {PersonaLoaderConfig} config - The configuration for loading personas.
   * @returns {Promise<void>} A promise that resolves when the loader is initialized.
   * @throws {Error} If initialization fails (e.g., invalid configuration, source not accessible).
   */
  initialize(config: PersonaLoaderConfig): Promise<void>;

  /**
   * Loads a single persona definition by its unique ID.
   * @async
   * @param {string} personaId - The ID of the persona to load.
   * @returns {Promise<IPersonaDefinition | undefined>} A promise that resolves with the persona definition
   * if found, or undefined otherwise.
   * @throws {Error} If loading fails for reasons other than the persona not being found (e.g., parsing error, source error).
   */
  loadPersonaById(personaId: string): Promise<IPersonaDefinition | undefined>;

  /**
   * Loads all available persona definitions from the configured source.
   * @async
   * @returns {Promise<IPersonaDefinition[]>} A promise that resolves with an array of all loaded
   * persona definitions. Returns an empty array if no personas are found.
   * @throws {Error} If loading fails (e.g., source inaccessible, multiple parsing errors).
   */
  loadAllPersonaDefinitions(): Promise<IPersonaDefinition[]>;

  /**
   * Optional: Reloads persona definitions. Useful if personas can change dynamically.
   * @async
   * @returns {Promise<void>} A promise that resolves when personas have been reloaded.
   * @throws {Error} If reloading fails.
   */
  refreshPersonas?(): Promise<void>;
}