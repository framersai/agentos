export function createAgentOSConfig(overrides) {
    return {
        port: 3001,
        host: 'localhost',
        enableCors: true,
        corsOrigin: '*',
        maxRequestSize: '10mb',
        ...overrides
    };
}
//# sourceMappingURL=ServerConfig.js.map