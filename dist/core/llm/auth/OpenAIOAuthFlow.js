/**
 * @fileoverview OpenAI OAuth PKCE flow — browser-based, like the Codex CLI.
 *
 * Uses the same public client ID and endpoints as the Codex CLI to obtain
 * API access tokens from OpenAI consumer subscriptions (ChatGPT Plus/Pro).
 *
 * Flow (browser-based PKCE — bypasses Cloudflare challenges):
 * 1. Generate PKCE code_verifier + code_challenge
 * 2. Start a local HTTP server on localhost:1455
 * 3. Open the user's browser to OpenAI's /authorize endpoint
 * 4. User logs in via browser → OpenAI redirects to localhost:1455/auth/callback
 * 5. Exchange authorization_code + code_verifier for tokens via /oauth/token
 *
 * @module agentos/core/llm/auth/OpenAIOAuthFlow
 */
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { FileTokenStore } from './FileTokenStore.js';
/** OpenAI's public Codex CLI client ID. */
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
/** OpenAI auth base URL. */
const AUTH_BASE_URL = 'https://auth.openai.com';
/** Local callback server port (same as Codex CLI). */
const CALLBACK_PORT = 1455;
/** Redirect URI — must match what OpenAI expects for this client ID. */
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`;
/** Common headers for token exchange requests. */
const AUTH_HEADERS = {
    'User-Agent': 'wunderland-cli/1.0 (OpenAI OAuth; +https://wunderland.sh)',
    'Accept': 'application/json',
};
/** Buffer in ms before expiry to trigger refresh (5 minutes). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
/** Maximum time to wait for user to authorize (10 minutes). */
const MAX_AUTH_TIMEOUT_MS = 10 * 60 * 1000;
export class OpenAIOAuthFlow {
    constructor(opts) {
        this.providerId = 'openai';
        this.refreshPromise = null;
        this.store = opts?.tokenStore ?? new FileTokenStore();
        this.clientId = opts?.clientId ?? OPENAI_CLIENT_ID;
        this.onBrowserOpen = opts?.onBrowserOpen ?? (() => { });
    }
    /**
     * Run the browser-based PKCE OAuth flow.
     * Opens the user's browser, waits for the callback, exchanges for tokens.
     */
    async authenticate() {
        // Step 1: Generate PKCE pair
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);
        const state = randomBytes(16).toString('hex');
        // Step 2: Start local callback server
        const { promise: callbackPromise, server } = startCallbackServer(state);
        try {
            // Step 3: Build authorization URL and open browser
            const authUrl = buildAuthUrl(this.clientId, codeChallenge, state);
            this.onBrowserOpen(authUrl);
            // Open the system browser
            await openBrowser(authUrl);
            // Step 4: Wait for the callback with auth code (with cancellable timeout)
            let timeoutTimer;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutTimer = setTimeout(() => {
                    reject(new Error('OAuth authorization timed out. Please try again.'));
                }, MAX_AUTH_TIMEOUT_MS);
            });
            const authCode = await Promise.race([callbackPromise, timeoutPromise]);
            clearTimeout(timeoutTimer);
            // Step 5: Exchange authorization code for tokens
            const tokenRes = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
                method: 'POST',
                headers: { ...AUTH_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: authCode,
                    redirect_uri: REDIRECT_URI,
                    client_id: this.clientId,
                    code_verifier: codeVerifier,
                }).toString(),
            });
            if (!tokenRes.ok) {
                const body = await tokenRes.text();
                throw new Error(`Token exchange failed: ${tokenRes.status} ${body}`);
            }
            const tokenData = await tokenRes.json();
            // Step 6: Exchange id_token for an OpenAI API key (like Codex CLI's obtain_api_key)
            let apiKey = tokenData.access_token;
            if (tokenData.id_token) {
                try {
                    apiKey = await this.obtainApiKey(tokenData.id_token);
                }
                catch {
                    // Fall back to access_token if API key exchange fails
                }
            }
            const tokens = {
                accessToken: apiKey,
                refreshToken: tokenData.refresh_token,
                expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
                idToken: tokenData.id_token,
            };
            await this.store.save(this.providerId, tokens);
            return tokens;
        }
        finally {
            // Force-close the callback server and all open connections
            server.closeAllConnections();
            server.close();
        }
    }
    /**
     * Exchange an id_token for an OpenAI API key.
     * This mirrors Codex CLI's `obtain_api_key()` step.
     */
    async obtainApiKey(idToken) {
        const res = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
            method: 'POST',
            headers: { ...AUTH_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
                client_id: this.clientId,
                requested_token: 'openai-api-key',
                subject_token: idToken,
                subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            }).toString(),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`API key exchange failed: ${res.status} ${body}`);
        }
        const data = await res.json();
        return data.access_token;
    }
    /**
     * Refresh an expired access token using the refresh token.
     */
    async refresh(tokens) {
        if (!tokens.refreshToken) {
            throw new Error('No refresh token available. Please run authenticate() again.');
        }
        const res = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
            method: 'POST',
            headers: { ...AUTH_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: tokens.refreshToken,
                client_id: this.clientId,
            }).toString(),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Token refresh failed: ${res.status} ${body}`);
        }
        const data = await res.json();
        const refreshed = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? tokens.refreshToken,
            expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
        };
        await this.store.save(this.providerId, refreshed);
        return refreshed;
    }
    /**
     * Check if the token set is still valid (not expired, with buffer).
     */
    isValid(tokens) {
        return Date.now() < tokens.expiresAt - REFRESH_BUFFER_MS;
    }
    /**
     * Get a usable access token. Loads from store, refreshes if needed.
     * Uses a mutex to prevent concurrent refresh races.
     */
    async getAccessToken() {
        const tokens = await this.store.load(this.providerId);
        if (!tokens) {
            throw new Error('No OpenAI OAuth tokens found. Run `wunderland login` to authenticate with your OpenAI subscription.');
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
// ── PKCE helpers ────────────────────────────────────────────────────────────
function generateCodeVerifier() {
    return randomBytes(32).toString('base64url');
}
function generateCodeChallenge(verifier) {
    return createHash('sha256').update(verifier).digest('base64url');
}
// ── Authorization URL builder ───────────────────────────────────────────────
function buildAuthUrl(clientId, codeChallenge, state) {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
    });
    return `${AUTH_BASE_URL}/oauth/authorize?${params.toString()}`;
}
// ── Local callback server ───────────────────────────────────────────────────
const SUCCESS_HTML = `<!DOCTYPE html><html><head><title>Wunderland — Authenticated</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0f;color:#c9d1d9}
.card{text-align:center;padding:3rem;border:1px solid #a855f7;border-radius:16px;max-width:420px}
h1{color:#a855f7;margin:0 0 1rem}p{color:#6b7280;line-height:1.6}
.check{font-size:3rem;margin-bottom:1rem}</style></head>
<body><div class="card"><div class="check">✓</div><h1>Authenticated</h1>
<p>You can close this tab and return to your terminal.</p></div></body></html>`;
const ERROR_HTML = (msg) => `<!DOCTYPE html><html><head><title>Wunderland — Error</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0f;color:#c9d1d9}
.card{text-align:center;padding:3rem;border:1px solid #ef4444;border-radius:16px;max-width:420px}
h1{color:#ef4444;margin:0 0 1rem}p{color:#6b7280;line-height:1.6}</style></head>
<body><div class="card"><h1>Authentication Failed</h1><p>${msg}</p></div></body></html>`;
function startCallbackServer(expectedState) {
    let resolveCode;
    let rejectCode;
    const promise = new Promise((resolve, reject) => {
        resolveCode = resolve;
        rejectCode = reject;
    });
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`);
        if (url.pathname !== '/auth/callback') {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');
        if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(ERROR_HTML(errorDescription || error));
            rejectCode(new Error(`OAuth error: ${error} — ${errorDescription || 'unknown'}`));
            return;
        }
        if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(ERROR_HTML('No authorization code received.'));
            rejectCode(new Error('No authorization code in callback'));
            return;
        }
        if (state !== expectedState) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(ERROR_HTML('State mismatch — possible CSRF attack.'));
            rejectCode(new Error('OAuth state mismatch'));
            return;
        }
        // Success
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(SUCCESS_HTML);
        resolveCode(code);
    });
    server.listen(CALLBACK_PORT, '127.0.0.1');
    return { promise, server };
}
// ── Browser opener ──────────────────────────────────────────────────────────
async function openBrowser(url) {
    const { exec } = await import('node:child_process');
    const { platform } = await import('node:os');
    const cmd = platform() === 'darwin'
        ? `open "${url}"`
        : platform() === 'win32'
            ? `start "" "${url}"`
            : `xdg-open "${url}"`;
    return new Promise((resolve) => {
        exec(cmd, () => resolve());
    });
}
//# sourceMappingURL=OpenAIOAuthFlow.js.map