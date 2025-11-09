// agentos/server/config/ServerConfig.ts
export interface AgentOSServerConfig {
  port?: number;
  host?: string;
  apiKey?: string;
  enableCors?: boolean;
  corsOrigin?: string | string[];
  maxRequestSize?: string;
}

export function createAgentOSConfig(overrides?: Partial<AgentOSServerConfig>): AgentOSServerConfig {
  return {
    port: 3001,
    host: 'localhost',
    enableCors: true,
    corsOrigin: '*',
    maxRequestSize: '10mb',
    ...overrides
  };
}
