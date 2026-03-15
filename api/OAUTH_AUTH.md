# OAuth Authentication Module

The `@framers/agentos/auth` subpath export provides OAuth authentication primitives for LLM providers. It implements the device code flow for obtaining API access tokens from consumer subscriptions.

## Architecture

```
@framers/agentos/auth
├── types.ts              # Core interfaces: IOAuthFlow, IOAuthTokenStore, OAuthTokenSet
├── FileTokenStore.ts     # File-based token persistence (~/.wunderland/auth/)
├── OpenAIOAuthFlow.ts    # OpenAI device code flow implementation
└── index.ts              # Barrel export
```

### Core Interfaces

```typescript
type AuthMethod = 'api-key' | 'oauth';

interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix epoch ms
}

interface IOAuthFlow {
  readonly providerId: string;
  authenticate(): Promise<OAuthTokenSet>;
  refresh(tokens: OAuthTokenSet): Promise<OAuthTokenSet>;
  isValid(tokens: OAuthTokenSet): boolean;
  getAccessToken(): Promise<string>;
}

interface IOAuthTokenStore {
  load(providerId: string): Promise<OAuthTokenSet | null>;
  save(providerId: string, tokens: OAuthTokenSet): Promise<void>;
  clear(providerId: string): Promise<void>;
}
```

These interfaces are provider-agnostic. `IOAuthFlow` defines the contract for any OAuth-based LLM provider authentication, and `IOAuthTokenStore` abstracts token persistence.

## OpenAI Implementation

`OpenAIOAuthFlow` implements `IOAuthFlow` for OpenAI's device code flow, using the same public client ID and endpoints as the Codex CLI.

### Endpoints

| Step | Endpoint | Method |
|------|----------|--------|
| Request device code | `https://auth.openai.com/deviceauth/usercode` | POST |
| Poll for authorization | `https://auth.openai.com/deviceauth/token` | POST |
| Exchange code for tokens | `https://auth.openai.com/oauth/token` | POST |
| Refresh tokens | `https://auth.openai.com/oauth/token` | POST |

### Usage

```typescript
import { OpenAIOAuthFlow, FileTokenStore } from '@framers/agentos/auth';

const flow = new OpenAIOAuthFlow({
  tokenStore: new FileTokenStore(),
  onUserCode: (code, url) => {
    console.log(`Visit ${url} and enter: ${code}`);
  },
});

// Interactive login
const tokens = await flow.authenticate();

// Get a usable token (auto-refreshes if expired)
const apiKey = await flow.getAccessToken();

// Check validity
flow.isValid(tokens); // true if not expired (with 5-min buffer)
```

### Options

```typescript
interface OpenAIOAuthFlowOptions {
  tokenStore?: IOAuthTokenStore;  // Default: FileTokenStore
  clientId?: string;              // Default: Codex CLI public client ID
  onUserCode?: (userCode: string, verificationUrl: string) => void;
}
```

## FileTokenStore

Stores tokens as JSON files at `~/.wunderland/auth/{providerId}.json` with `0o600` permissions.

```typescript
import { FileTokenStore } from '@framers/agentos/auth';

const store = new FileTokenStore();            // Default: ~/.wunderland/auth/
const store2 = new FileTokenStore('/custom');   // Custom directory

await store.save('openai', tokens);
const loaded = await store.load('openai');      // OAuthTokenSet | null
await store.clear('openai');                    // Deletes the file
```

Features:
- Creates directories recursively if they don't exist
- Sanitizes provider IDs to prevent path traversal
- Returns `null` for corrupted or invalid JSON
- Works with any `providerId` string

## Integration with LLM Providers

The `OpenAIProvider` in AgentOS core accepts an optional `oauthFlow` config:

```typescript
const provider = new OpenAIProvider({
  apiKey: '',          // Not needed when using oauthFlow
  model: 'gpt-4o',
  oauthFlow: flow,     // { getAccessToken(): Promise<string> }
});
```

When `oauthFlow` is set, the provider calls `getAccessToken()` before each API request instead of using the static `apiKey`.

## Adding New Providers

To add OAuth support for a new LLM provider:

1. Create a new class implementing `IOAuthFlow`
2. Set `providerId` to the provider's registry ID (e.g., `'anthropic'`)
3. Implement the provider's OAuth flow in `authenticate()`
4. Implement token refresh in `refresh()`
5. Use `FileTokenStore` or a custom `IOAuthTokenStore` for persistence

```typescript
export class ExampleOAuthFlow implements IOAuthFlow {
  readonly providerId = 'example-provider';
  // ... implement authenticate(), refresh(), isValid(), getAccessToken()
}
```

The `FileTokenStore` automatically namespaces by `providerId`, so multiple providers can coexist.

### Current Provider Support

| Provider | Status | Reason |
|----------|--------|--------|
| OpenAI | Supported | Codex CLI device code flow |
| Anthropic | Not supported | No consumer OAuth API; session tokens violate ToS |
| Google Gemini | Not supported | API keys only; no consumer OAuth for API access |

Only providers with legitimate, Terms of Service-compliant OAuth flows should be implemented. Session token extraction from consumer web products is not supported.

## Subpath Export

Import from `@framers/agentos/auth`:

```typescript
import {
  OpenAIOAuthFlow,
  FileTokenStore,
  type IOAuthFlow,
  type IOAuthTokenStore,
  type OAuthTokenSet,
  type AuthMethod,
  type OAuthProviderConfig,
  type OpenAIOAuthFlowOptions,
} from '@framers/agentos/auth';
```

The export is configured in `package.json`:

```json
{
  "exports": {
    "./auth": {
      "import": "./dist/core/llm/auth/index.js",
      "types": "./dist/core/llm/auth/index.d.ts"
    }
  }
}
```
