import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  clearRecordedAgentOSUsage,
  getDefaultAgentOSUsageLedgerPath,
  getRecordedAgentOSUsage,
  recordAgentOSUsage,
  resolveAgentOSUsageLedgerPath,
} from '../usageLedger.js';

describe('AgentOS usage ledger', () => {
  afterEach(async () => {
    delete process.env.AGENTOS_USAGE_LEDGER_PATH;
    delete process.env.WUNDERLAND_USAGE_LEDGER_PATH;
  });

  it('resolves an env-backed ledger path', () => {
    const ledgerPath = path.join(os.tmpdir(), `agentos-usage-${Date.now()}.jsonl`);
    process.env.AGENTOS_USAGE_LEDGER_PATH = ledgerPath;

    expect(resolveAgentOSUsageLedgerPath()).toBe(ledgerPath);
  });

  it('accepts the Wunderland ledger env var for shared cross-product usage', () => {
    const ledgerPath = path.join(os.tmpdir(), `shared-usage-${Date.now()}.jsonl`);
    process.env.WUNDERLAND_USAGE_LEDGER_PATH = ledgerPath;

    expect(resolveAgentOSUsageLedgerPath()).toBe(ledgerPath);
  });

  it('records and aggregates usage by session', async () => {
    const ledgerPath = path.join(os.tmpdir(), `agentos-usage-${Date.now()}.jsonl`);

    await recordAgentOSUsage({
      providerId: 'openai',
      modelId: 'gpt-4.1-mini',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUSD: 0.002 },
      options: { path: ledgerPath, sessionId: 'session-a', source: 'generateText' },
    });
    await recordAgentOSUsage({
      providerId: 'openai',
      modelId: 'gpt-4.1-mini',
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5, costUSD: 0.001 },
      options: { path: ledgerPath, sessionId: 'session-b', source: 'streamText' },
    });

    await expect(getRecordedAgentOSUsage({ path: ledgerPath })).resolves.toEqual({
      sessionId: undefined,
      personaId: undefined,
      promptTokens: 13,
      completionTokens: 7,
      totalTokens: 20,
      costUSD: 0.003,
      calls: 2,
    });

    await expect(getRecordedAgentOSUsage({ path: ledgerPath, sessionId: 'session-a' })).resolves.toEqual({
      sessionId: 'session-a',
      personaId: undefined,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      costUSD: 0.002,
      calls: 1,
    });

    await clearRecordedAgentOSUsage({ path: ledgerPath });
  });

  it('does not persist when disabled and no explicit path is configured', async () => {
    await expect(recordAgentOSUsage({
      providerId: 'openai',
      modelId: 'gpt-4.1-mini',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUSD: 0.0001 },
    })).resolves.toBe(false);
  });

  it('uses the shared home-directory ledger path when enabled', async () => {
    expect(getDefaultAgentOSUsageLedgerPath()).toBe(path.join(os.homedir(), '.framers', 'usage-ledger.jsonl'));
    expect(resolveAgentOSUsageLedgerPath({ enabled: true })).toBe(getDefaultAgentOSUsageLedgerPath());
  });
});
