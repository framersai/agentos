export interface AgentOSServerConfig {
    port?: number;
    host?: string;
    apiKey?: string;
    enableCors?: boolean;
    corsOrigin?: string | string[];
    maxRequestSize?: string;
}
export declare function createAgentOSConfig(overrides?: Partial<AgentOSServerConfig>): AgentOSServerConfig;
//# sourceMappingURL=ServerConfig.d.ts.map