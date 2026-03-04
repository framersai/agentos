/**
 * @fileoverview Ephemeral localhost HTTP server for OAuth 2.0 authorization code callbacks.
 *
 * Listens on an OS-assigned port, waits for a single GET /callback with
 * code + state query params, validates the state, and resolves.
 *
 * @module agentos/core/llm/auth/callback-server
 */

import { createServer, type Server } from 'node:http';
import { URL } from 'node:url';

export interface CallbackResult {
  code: string;
  state: string;
}

export interface CallbackServerOptions {
  /** Expected state value for CSRF validation. */
  expectedState: string;
  /** Maximum time (ms) to wait for the callback before timing out. */
  timeoutMs: number;
  /** Called once the server is listening, with the assigned port. */
  onListening?: (port: number) => void;
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><title>Authorization Complete</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex;
    justify-content: center; align-items: center; height: 100vh; margin: 0;
    background: #0a0a0a; color: #e0e0e0; }
  .card { text-align: center; padding: 3rem; border-radius: 12px;
    background: #1a1a1a; border: 1px solid #333; }
  h1 { color: #4ade80; margin-bottom: 0.5rem; }
  p { color: #888; }
</style></head>
<body><div class="card">
  <h1>Authorized</h1>
  <p>You can close this tab and return to the terminal.</p>
</div></body></html>`;

const ERROR_HTML = (msg: string) => `<!DOCTYPE html>
<html><head><title>Authorization Failed</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex;
    justify-content: center; align-items: center; height: 100vh; margin: 0;
    background: #0a0a0a; color: #e0e0e0; }
  .card { text-align: center; padding: 3rem; border-radius: 12px;
    background: #1a1a1a; border: 1px solid #333; }
  h1 { color: #f87171; margin-bottom: 0.5rem; }
  p { color: #888; }
</style></head>
<body><div class="card">
  <h1>Authorization Failed</h1>
  <p>${msg}</p>
</div></body></html>`;

/**
 * Start an ephemeral localhost HTTP server to receive the OAuth callback.
 *
 * @returns An object with:
 *  - `promise` — resolves with `{ code, state }` on success, rejects on timeout/error
 *  - `shutdown()` — forcibly close the server
 */
export function startCallbackServer(opts: CallbackServerOptions): {
  promise: Promise<CallbackResult>;
  shutdown: () => void;
} {
  let server: Server;
  let timer: ReturnType<typeof setTimeout>;

  const promise = new Promise<CallbackResult>((resolve, reject) => {
    server = createServer((req, res) => {
      if (!req.url || !req.url.startsWith('/callback')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const url = new URL(req.url, `http://localhost`);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(ERROR_HTML(errorDescription || error));
        cleanup();
        reject(new Error(`OAuth error: ${errorDescription || error}`));
        return;
      }

      if (!code || !state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(ERROR_HTML('Missing code or state parameter.'));
        return;
      }

      if (state !== opts.expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(ERROR_HTML('State mismatch — possible CSRF attack.'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(SUCCESS_HTML);
      cleanup();
      resolve({ code, state });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      opts.onListening?.(port);
    });

    server.on('error', (err) => {
      cleanup();
      reject(err);
    });

    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`OAuth callback timed out after ${Math.round(opts.timeoutMs / 1000)}s. Please try again.`));
    }, opts.timeoutMs);
  });

  function cleanup() {
    clearTimeout(timer);
    try { server?.close(); } catch { /* ignore */ }
  }

  return {
    promise,
    shutdown: cleanup,
  };
}
