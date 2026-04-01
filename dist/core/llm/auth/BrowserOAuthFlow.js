/**
 * @fileoverview Abstract base class for browser-based OAuth 2.0 authorization code
 * flows with PKCE support.
 *
 * Orchestrates: localhost callback server → browser open → code exchange → token storage.
 * Subclasses implement provider-specific URL building, code exchange, and token refresh.
 *
 * @module agentos/core/llm/auth/BrowserOAuthFlow
 */
import { FileTokenStore } from './FileTokenStore.js';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.js';
import { startCallbackServer } from './callback-server.js';
import { isTokenValid, openBrowser } from './utils.js';
/** Default timeout for user authorization (5 minutes). */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
/** Default refresh buffer (5 minutes before expiry). */
const DEFAULT_REFRESH_BUFFER_MS = 5 * 60 * 1000;
export class BrowserOAuthFlow {
    constructor(opts) {
        this.refreshPromise = null;
        this.store = opts?.tokenStore ?? new FileTokenStore();
        this.onAuthUrl = opts?.onAuthUrl;
    }
    // ── Optional hooks ──
    /**
     * Post-exchange hook for provider-specific processing.
     * E.g., Instagram exchanges short-lived for long-lived tokens here.
     * Default: passthrough.
     */
    async postExchange(tokens) {
        return tokens;
    }
    // ── IOAuthFlow implementation ──
    async authenticate() {
        const config = this.getConfig();
        const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        // 1. Generate PKCE pair + state
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);
        const state = generateState();
        // 2. Start callback server (port 0 = OS-assigned)
        let assignedPort = 0;
        const { promise: callbackPromise, shutdown } = startCallbackServer({
            expectedState: state,
            timeoutMs,
            onListening: (port) => { assignedPort = port; },
        });
        // Wait briefly for the server to start listening
        await new Promise((resolve) => {
            const check = () => {
                if (assignedPort > 0) {
                    resolve();
                    return;
                }
                setTimeout(check, 10);
            };
            check();
        });
        const redirectUri = `http://localhost:${assignedPort}/callback`;
        // 3. Build authorization URL
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: config.clientId,
            redirect_uri: redirectUri,
            scope: config.scopes.join(' '),
            state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        });
        const authUrl = `${config.authorizationEndpoint}?${params.toString()}`;
        // 4. Open browser (or print URL)
        if (this.onAuthUrl) {
            this.onAuthUrl(authUrl);
        }
        const opened = await openBrowser(authUrl);
        if (!opened && !this.onAuthUrl) {
            console.log(`\n  Open this URL in your browser to authorize:\n  ${authUrl}\n`);
        }
        // 5. Wait for callback
        let result;
        try {
            result = await callbackPromise;
        }
        catch (err) {
            shutdown();
            throw err;
        }
        // 6. Exchange code for tokens
        let tokens = await this.exchangeCode(result.code, redirectUri, codeVerifier);
        // 7. Post-exchange hook
        tokens = await this.postExchange(tokens);
        // 8. Store
        await this.store.save(this.providerId, tokens);
        return tokens;
    }
    async refresh(tokens) {
        if (!tokens.refreshToken) {
            throw new Error(`No refresh token available for ${this.providerId}. Run \`wunderland login --provider ${this.providerId}\` to re-authenticate.`);
        }
        const refreshed = await this.refreshTokens(tokens.refreshToken);
        // Preserve refresh token if the provider omits it in the response
        if (!refreshed.refreshToken && tokens.refreshToken) {
            refreshed.refreshToken = tokens.refreshToken;
        }
        // Preserve metadata
        if (!refreshed.metadata && tokens.metadata) {
            refreshed.metadata = tokens.metadata;
        }
        await this.store.save(this.providerId, refreshed);
        return refreshed;
    }
    isValid(tokens) {
        const config = this.getConfig();
        return isTokenValid(tokens, config.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS);
    }
    async getAccessToken() {
        const tokens = await this.store.load(this.providerId);
        if (!tokens) {
            throw new Error(`No ${this.providerId} OAuth tokens found. Run \`wunderland login --provider ${this.providerId}\` to authenticate.`);
        }
        if (this.isValid(tokens)) {
            return tokens.accessToken;
        }
        // Need refresh — use mutex to prevent concurrent refreshes
        if (!this.refreshPromise) {
            this.refreshPromise = this.refresh(tokens).finally(() => {
                this.refreshPromise = null;
            });
        }
        const refreshed = await this.refreshPromise;
        return refreshed.accessToken;
    }
}
//# sourceMappingURL=BrowserOAuthFlow.js.map