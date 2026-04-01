// File: backend/agentos/cognitive_substrate/personas/PersonaLoader.ts
/**
 * @fileoverview Implements a PersonaLoader that reads persona definitions
 * from JSON files within a specified directory. Each .json file in the directory
 * (and its subdirectories, optionally) is expected to contain a valid IPersonaDefinition.
 *
 * @module backend/agentos/cognitive_substrate/personas/PersonaLoader
 * @see ./IPersonaDefinition.ts
 * @see ./IPersonaLoader.ts
 */
import * as fsPromises from 'fs/promises'; // Use fs/promises for async operations
import * as path from 'path';
import { uuidv4 } from '../../core/utils/uuid.js';
import { GMIError, GMIErrorCode } from '../../core/utils/errors.js';
import { mergeMetapromptPresets } from './metaprompt_presets.js';
/**
 * Implements IPersonaLoader to load persona definitions from the file system.
 * Assumes persona definitions are stored as individual JSON files.
 * @class PersonaLoader
 * @implements {IPersonaLoader}
 */
export class PersonaLoader {
    constructor() {
        this.isInitialized = false;
        this.loadedPersonas = new Map();
        this.loaderId = `persona-loader-fs-${uuidv4()}`;
    }
    ensureInitialized() {
        if (!this.isInitialized) {
            throw new GMIError('PersonaLoader has not been initialized. Call initialize() first.', GMIErrorCode.NOT_INITIALIZED, { loaderId: this.loaderId });
        }
    }
    async initialize(config) {
        if (this.isInitialized) {
            console.warn(`PersonaLoader (ID: ${this.loaderId}) already initialized. Re-initializing will refresh personas.`);
        }
        const fsConfig = config;
        if (!fsConfig || !fsConfig.personaDefinitionPath) {
            throw new GMIError('Invalid configuration for FileSystemPersonaLoader: personaDefinitionPath is required.', GMIErrorCode.CONFIGURATION_ERROR, { providedConfig: config, loaderId: this.loaderId });
        }
        this.config = {
            ...fsConfig,
            loaderType: 'file_system',
            recursiveSearch: fsConfig.recursiveSearch ?? false,
            fileExtension: fsConfig.fileExtension && fsConfig.fileExtension.startsWith('.')
                ? fsConfig.fileExtension.toLowerCase()
                : (fsConfig.fileExtension ? `.${fsConfig.fileExtension.toLowerCase()}` : '.json'),
        };
        try {
            const stats = await fsPromises.stat(this.config.personaDefinitionPath);
            if (!stats.isDirectory()) {
                throw new GMIError(`Persona definition path '${this.config.personaDefinitionPath}' is not a directory.`, GMIErrorCode.CONFIGURATION_ERROR, { path: this.config.personaDefinitionPath });
            }
        }
        catch (error) {
            throw new GMIError(`Persona definition path '${this.config.personaDefinitionPath}' is not accessible or does not exist: ${error.message}`, GMIErrorCode.CONFIGURATION_ERROR, // Corrected: Use CONFIGURATION_ERROR
            { path: this.config.personaDefinitionPath, underlyingError: error });
        }
        this.isInitialized = true;
        console.log(`PersonaLoader (ID: ${this.loaderId}) initialized. Source directory: '${this.config.personaDefinitionPath}'.`);
        await this.refreshPersonas();
    }
    async findPersonaFiles(dirPath, extension) {
        let dirents;
        try {
            dirents = await fsPromises.readdir(dirPath, { withFileTypes: true });
        }
        catch (error) {
            console.error(`PersonaLoader (ID: ${this.loaderId}): Error reading directory ${dirPath}: ${error.message}`);
            return [];
        }
        const files = await Promise.all(dirents.map(async (dirent) => {
            const res = path.resolve(dirPath, dirent.name);
            if (dirent.isDirectory() && this.config.recursiveSearch) {
                return this.findPersonaFiles(res, extension);
            }
            else if (dirent.isFile() && path.extname(dirent.name).toLowerCase() === extension) {
                return [res];
            }
            return [];
        }));
        return files.flat();
    }
    async loadPersonaById(personaId) {
        this.ensureInitialized();
        const persona = this.loadedPersonas.get(personaId);
        if (!persona) {
            console.warn(`PersonaLoader (ID: ${this.loaderId}): Persona with ID '${personaId}' not found in cache.`);
            return undefined;
        }
        return JSON.parse(JSON.stringify(persona));
    }
    async loadAllPersonaDefinitions() {
        this.ensureInitialized();
        return Array.from(this.loadedPersonas.values()).map(p => JSON.parse(JSON.stringify(p)));
    }
    async refreshPersonas() {
        this.ensureInitialized();
        const oldSize = this.loadedPersonas.size;
        this.loadedPersonas.clear();
        console.log(`PersonaLoader (ID: ${this.loaderId}): Refreshing personas from '${this.config.personaDefinitionPath}'...`);
        let personaFilePaths;
        try {
            personaFilePaths = await this.findPersonaFiles(this.config.personaDefinitionPath, this.config.fileExtension);
        }
        catch (error) {
            console.error(`PersonaLoader (ID: ${this.loaderId}): Error scanning persona directory '${this.config.personaDefinitionPath}': ${error.message}`);
            throw new GMIError(`Failed to scan persona directory: ${error.message}`, GMIErrorCode.PERSONA_LOAD_ERROR, { path: this.config.personaDefinitionPath, underlyingError: error }); // Corrected: Use PERSONA_LOAD_ERROR
        }
        if (personaFilePaths.length === 0) {
            console.warn(`PersonaLoader (ID: ${this.loaderId}): No persona files found in '${this.config.personaDefinitionPath}' with extension '${this.config.fileExtension}'. Previous cache size: ${oldSize}.`);
            return;
        }
        for (const filePath of personaFilePaths) {
            try {
                const fileContent = await fsPromises.readFile(filePath, 'utf-8');
                const personaDefinition = JSON.parse(fileContent);
                if (!personaDefinition.id || !personaDefinition.name || !personaDefinition.baseSystemPrompt || !personaDefinition.version) {
                    console.warn(`PersonaLoader (ID: ${this.loaderId}): Skipping file '${filePath}' due to missing required fields (id, name, version, baseSystemPrompt).`);
                    continue;
                }
                // Only merge sentiment-aware preset metaprompts when explicitly enabled
                const sentimentConfig = personaDefinition.sentimentTracking;
                if (sentimentConfig?.enabled && sentimentConfig.presets && sentimentConfig.presets.length > 0) {
                    // Map short preset names to full metaprompt IDs
                    const presetNameToId = {
                        'frustration_recovery': 'gmi_frustration_recovery',
                        'confusion_clarification': 'gmi_confusion_clarification',
                        'satisfaction_reinforcement': 'gmi_satisfaction_reinforcement',
                        'error_recovery': 'gmi_error_recovery',
                        'engagement_boost': 'gmi_engagement_boost',
                    };
                    const requestedIds = sentimentConfig.presets.includes('all')
                        ? undefined // undefined = include all presets
                        : sentimentConfig.presets
                            .filter((p) => p !== 'all')
                            .map((p) => presetNameToId[p])
                            .filter(Boolean);
                    personaDefinition.metaPrompts = mergeMetapromptPresets(personaDefinition.metaPrompts, requestedIds);
                    console.log(`PersonaLoader (ID: ${this.loaderId}): Merged ${personaDefinition.metaPrompts.length} metaprompts (${requestedIds ? requestedIds.length + ' presets' : 'all presets'} + custom) for persona '${personaDefinition.id}'.`);
                }
                if (this.loadedPersonas.has(personaDefinition.id)) {
                    console.warn(`PersonaLoader (ID: ${this.loaderId}): Duplicate persona ID '${personaDefinition.id}' found in file '${filePath}'. Overwriting previous definition. Ensure persona IDs are unique.`);
                }
                this.loadedPersonas.set(personaDefinition.id, personaDefinition);
            }
            catch (error) {
                console.error(`PersonaLoader (ID: ${this.loaderId}): Error loading or parsing persona from file '${filePath}': ${error.message}`, error);
            }
        }
        console.log(`PersonaLoader (ID: ${this.loaderId}): Successfully loaded/refreshed ${this.loadedPersonas.size} persona definitions.`);
    }
    async shutdown() {
        this.isInitialized = false;
        this.loadedPersonas.clear();
        console.log(`PersonaLoader (ID: ${this.loaderId}) shut down.`);
    }
}
//# sourceMappingURL=PersonaLoader.js.map