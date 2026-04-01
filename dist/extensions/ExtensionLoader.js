/**
 * Extension Registry Loader
 * Automatically discovers and loads extensions from npm and local registry
 */
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
/**
 * Loads and manages extensions from various sources
 */
export class ExtensionLoader {
    constructor(manager, config = {}) {
        this.manager = manager;
        this.loadedExtensions = new Map();
        this.extensionMetadata = new Map();
        this.config = {
            loadCurated: config.loadCurated !== false,
            loadCommunity: config.loadCommunity !== false,
            npmRegistry: config.npmRegistry || 'https://registry.npmjs.org',
            localRegistryPath: config.localRegistryPath || path.join(process.cwd(), 'packages/agentos-extensions/registry'),
            extensionScope: config.extensionScope || '@framers',
            cacheDir: config.cacheDir || path.join(process.cwd(), '.agentos/extensions'),
            autoInstall: config.autoInstall !== false,
            whitelist: config.whitelist || [],
            blacklist: config.blacklist || []
        };
    }
    /**
     * Initialize and load all configured extensions
     */
    async initialize() {
        console.log('🔌 Initializing Extension Loader...');
        // Load registry metadata
        await this.loadRegistryMetadata();
        // Load curated extensions
        if (this.config.loadCurated) {
            await this.loadCuratedExtensions();
        }
        // Load community extensions
        if (this.config.loadCommunity) {
            await this.loadCommunityExtensions();
        }
        // Load from npm if configured
        if (this.config.autoInstall) {
            await this.checkAndInstallMissing();
        }
        console.log(`✅ Loaded ${this.loadedExtensions.size} extensions`);
    }
    /**
     * Load registry metadata from local registry.json
     */
    async loadRegistryMetadata() {
        try {
            const registryPath = path.join(this.config.localRegistryPath, '../registry.json');
            const registryContent = await fs.readFile(registryPath, 'utf-8');
            const registry = JSON.parse(registryContent);
            // Load curated extensions metadata
            if (registry.extensions?.curated) {
                for (const ext of registry.extensions.curated) {
                    if (this.shouldLoadExtension(ext.package)) {
                        this.extensionMetadata.set(ext.package, ext);
                    }
                }
            }
            // Load community extensions metadata
            if (registry.extensions?.community) {
                for (const ext of registry.extensions.community) {
                    if (this.shouldLoadExtension(ext.package)) {
                        this.extensionMetadata.set(ext.package, ext);
                    }
                }
            }
        }
        catch (error) {
            console.warn('Could not load local registry:', error);
        }
    }
    /**
     * Check if an extension should be loaded based on whitelist/blacklist
     */
    shouldLoadExtension(packageName) {
        // Check blacklist
        if (this.config.blacklist.length > 0 && this.config.blacklist.includes(packageName)) {
            return false;
        }
        // Check whitelist
        if (this.config.whitelist.length > 0 && !this.config.whitelist.includes(packageName)) {
            return false;
        }
        return true;
    }
    /**
     * Load curated extensions
     */
    async loadCuratedExtensions() {
        console.log('📦 Loading curated extensions...');
        const curatedPackages = [
            '@framers/agentos-ext-web-search',
            '@framers/agentos-ext-telegram'
        ];
        for (const packageName of curatedPackages) {
            if (this.shouldLoadExtension(packageName)) {
                await this.loadExtension(packageName);
            }
        }
    }
    /**
     * Load community extensions
     */
    async loadCommunityExtensions() {
        console.log('👥 Loading community extensions...');
        // Get community extensions from metadata
        const communityPackages = Array.from(this.extensionMetadata.values())
            .filter(meta => !meta.verified)
            .map(meta => meta.package);
        for (const packageName of communityPackages) {
            if (this.shouldLoadExtension(packageName)) {
                await this.loadExtension(packageName);
            }
        }
    }
    /**
     * Load a specific extension
     */
    async loadExtension(packageName) {
        try {
            // Check if already loaded
            if (this.loadedExtensions.has(packageName)) {
                return this.loadedExtensions.get(packageName);
            }
            console.log(`Loading extension: ${packageName}`);
            // Try to load from node_modules first
            let extensionModule;
            try {
                extensionModule = await import(packageName);
            }
            catch (error) {
                if (this.config.autoInstall) {
                    console.log(`Installing ${packageName} from npm...`);
                    await this.installFromNpm(packageName);
                    extensionModule = await import(packageName);
                }
                else {
                    throw error;
                }
            }
            // Create extension pack
            const createPack = extensionModule.createExtensionPack || extensionModule.default;
            if (!createPack) {
                throw new Error(`Extension ${packageName} does not export createExtensionPack`);
            }
            const pack = createPack({
                options: this.getExtensionOptions(packageName),
                logger: console
            });
            // Load into manager
            await this.manager.loadPackFromFactory(pack, packageName);
            this.loadedExtensions.set(packageName, pack);
            return pack;
        }
        catch (error) {
            console.error(`Failed to load extension ${packageName}:`, error);
            return null;
        }
    }
    /**
     * Install extension from npm
     */
    async installFromNpm(packageName) {
        const { stderr } = await execAsync(`npm install ${packageName}`);
        if (stderr && !stderr.includes('WARN')) {
            throw new Error(`Failed to install ${packageName}: ${stderr}`);
        }
        console.log(`Installed ${packageName}`);
    }
    /**
     * Get extension-specific options from environment
     */
    getExtensionOptions(packageName) {
        const options = {};
        // Load from environment variables based on package name
        if (packageName.includes('telegram')) {
            options.botToken = process.env.TELEGRAM_BOT_TOKEN;
        }
        else if (packageName.includes('web-search')) {
            options.serperApiKey = process.env.SERPER_API_KEY;
            options.serpApiKey = process.env.SERPAPI_API_KEY;
            options.braveApiKey = process.env.BRAVE_API_KEY;
        }
        return options;
    }
    /**
     * Check for and install missing extensions
     */
    async checkAndInstallMissing() {
        console.log('🔍 Checking for missing extensions...');
        for (const [packageName] of this.extensionMetadata) {
            if (!this.loadedExtensions.has(packageName)) {
                console.log(`Missing extension: ${packageName}`);
                if (this.config.autoInstall) {
                    await this.loadExtension(packageName);
                }
            }
        }
    }
    /**
     * Search npm for AgentOS extensions
     */
    async searchNpmExtensions(query) {
        try {
            const searchQuery = query
                ? `${this.config.extensionScope} ${query}`
                : `${this.config.extensionScope}/agentos-`;
            const { stdout } = await execAsync(`npm search ${searchQuery} --json`);
            const results = JSON.parse(stdout);
            return results.map((pkg) => ({
                id: pkg.name,
                name: pkg.name.split('/').pop(),
                package: pkg.name,
                version: pkg.version,
                description: pkg.description,
                category: this.inferCategory(pkg.name)
            }));
        }
        catch (error) {
            console.error('Failed to search npm:', error);
            return [];
        }
    }
    /**
     * Infer category from package name
     */
    inferCategory(packageName) {
        // Treat web search/scraping extensions as "research".
        if (packageName.includes('web-search') || packageName.includes('web-scraper') || packageName.includes('web_scraper'))
            return 'research';
        if (packageName.includes('research'))
            return 'research';
        if (packageName.includes('integration'))
            return 'integrations';
        if (packageName.includes('productivity'))
            return 'productivity';
        if (packageName.includes('development'))
            return 'development';
        if (packageName.includes('utility'))
            return 'utilities';
        return 'other';
    }
    /**
     * Get loaded extensions
     */
    getLoadedExtensions() {
        return this.loadedExtensions;
    }
    /**
     * Get extension metadata
     */
    getExtensionMetadata() {
        return this.extensionMetadata;
    }
    /**
     * Get available tools from all loaded extensions
     */
    getAvailableTools() {
        const tools = [];
        for (const [packageName, pack] of this.loadedExtensions) {
            if (pack.descriptors) {
                for (const descriptor of pack.descriptors) {
                    if (descriptor.kind === 'tool' && descriptor.payload) {
                        const tool = descriptor.payload;
                        tools.push({
                            id: descriptor.id,
                            name: tool.displayName || tool.name,
                            description: tool.description,
                            extension: packageName,
                            inputSchema: tool.inputSchema,
                            outputSchema: tool.outputSchema,
                            hasSideEffects: tool.hasSideEffects
                        });
                    }
                }
            }
        }
        return tools;
    }
    /**
     * Reload all extensions
     */
    async reload() {
        console.log('🔄 Reloading extensions...');
        // Clear loaded extensions
        this.loadedExtensions.clear();
        this.extensionMetadata.clear();
        // Re-initialize
        await this.initialize();
    }
}
//# sourceMappingURL=ExtensionLoader.js.map