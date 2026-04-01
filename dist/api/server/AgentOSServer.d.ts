import { Server as HTTPServer } from 'http';
import type { AgentOSConfig } from '../AgentOS.js';
import { AgentOSServerConfig } from './config/ServerConfig';
export declare class AgentOSServer {
    private readonly agentOS;
    private readonly server;
    private readonly config;
    private agentReady;
    constructor(agentOSConfig: AgentOSConfig, serverConfig: AgentOSServerConfig);
    private handleRequest;
    private handleListPersonasRequest;
    private handleChatRequest;
    private readBody;
    private parseSizeToBytes;
    private sendJson;
    start(): Promise<void>;
    stop(): Promise<void>;
    getServer(): HTTPServer;
}
//# sourceMappingURL=AgentOSServer.d.ts.map