/**
 * @fileoverview souledAgent — first-class factory for a soul-file agent whose
 * long-term memory is the markdown `memory/` wiki.
 *
 * Composes existing, tested pieces:
 * - {@link loadSoulFromOption} resolves the soul and its `memory/` dir.
 * - {@link Memory.createSqlite} opens the single backing store (the rebuildable
 *   index; the markdown stays source of truth).
 * - {@link attachMemoryWiki} wires the wiki write-back loop + the
 *   `read_memory_page` tool + the boot index over the same facade.
 * - {@link agent} runs it; its `buildSystemPrompt` already injects `index.md`.
 *
 * One `Memory` facade is both the agent's live memory and the wiki store, so the
 * conversation the agent observes lands where the wiki compiler reads it.
 *
 * @module agentos/api/souledAgent
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  agent,
  loadSoulFromOption,
  type AgentOptions,
  type Agent,
  type AgentMemoryProvider,
} from './agent.js';
import { generateText } from './generateText.js';
import { Memory } from '../cognition/memory/io/facade/Memory.js';
import { attachMemoryWiki } from '../cognition/memory/io/attachMemoryWiki.js';
import { SemanticChunker } from '../cognition/rag/chunking/SemanticChunker.js';

/** Options for {@link souledAgent}. Identical to {@link AgentOptions}, but `soul` is required. */
export interface SouledAgentOptions extends AgentOptions {
  soul: NonNullable<AgentOptions['soul']>;
}

/**
 * Return type of {@link souledAgent}: an {@link Agent} with its backing
 * {@link Memory} store exposed as `memory`, so callers can fold conversation
 * into the wiki mid-session via `await agent.memory.compileWiki()`. `memory` is
 * present whenever the soul resolves to a workspace directory; it is absent for
 * inline souls that fall back to a plain agent.
 */
export type SouledAgent = Agent & { memory?: Memory };

/**
 * Create an agent whose long-term memory is its soul-file `memory/` wiki.
 *
 * When the soul resolves to a workspace directory, the wiki is wired end to end
 * (store + write-back + `read_memory_page` tool + prelude `index.md`). For inline
 * souls (`{ content }`) there is no workspace, so this falls back to a plain
 * {@link agent}.
 *
 * @param opts - Agent options with a required `soul`.
 * @returns A fully-wired {@link Agent}.
 */
export async function souledAgent(opts: SouledAgentOptions): Promise<SouledAgent> {
  const loaded = loadSoulFromOption(opts.soul);
  if (!loaded?.memoryDir) {
    // Inline soul or failed load: no workspace dir → no wiki. Plain agent.
    return agent(opts);
  }

  const agentId = loaded.frontmatter.agentId ?? opts.name ?? 'agent';

  // The markdown memory/ is source of truth; the sqlite is the rebuildable index.
  const storeDir = path.join(loaded.memoryDir, '.store');
  await fs.mkdir(storeDir, { recursive: true });
  const memory = await Memory.createSqlite(path.join(storeDir, 'memory.sqlite'), {
    graph: true,
    selfImprove: true,
  });

  // Adapt the Memory facade directly to the provider contract. AgentMemory's own
  // getContext/observe signatures don't match AgentMemoryProvider, so wrap the
  // facade's remember/recall here.
  const provider: AgentMemoryProvider = {
    observe: async (_role, text) => {
      await memory.remember(text, { type: 'episodic', scope: 'persona', scopeId: agentId });
    },
    getContext: async (text) => {
      const scored = await memory.recall(text, { limit: 8 });
      const contextText = scored.map((s) => s.trace.content).join('\n');
      return contextText ? { contextText } : null;
    },
  };

  const llm = async (prompt: string): Promise<string> =>
    (
      await generateText({
        provider: opts.provider,
        model: opts.model,
        prompt,
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
      })
    ).text;

  const chunker = new SemanticChunker();
  const priorTools = opts.tools;
  const { tools: augmentedTools } = await attachMemoryWiki({
    memory,
    memoryDir: loaded.memoryDir,
    agentId,
    llm,
    chunk: (t) => chunker.chunk(t).map((c) => ({ text: c.text })),
    tools: Array.isArray(priorTools) ? [...priorTools] : undefined,
  });

  // attachMemoryWiki appends read_memory_page to an array. Use the augmented
  // array when tools were an array (or absent); pass map/registry inputs through
  // unchanged (the rare non-array AdaptableToolInput shapes).
  const tools = (
    priorTools && !Array.isArray(priorTools) ? priorTools : augmentedTools
  ) as AgentOptions['tools'];

  const built = agent({ ...opts, memoryProvider: provider, tools }) as SouledAgent;

  // On teardown: fold the session's conversation into the wiki, then close the
  // backing store. The compile is best-effort (a failed LLM merge must never
  // block teardown); closing prevents leaked SQLite handles in long-lived hosts.
  const originalClose = built.close.bind(built);
  built.close = async () => {
    try {
      await memory.compileWiki({ reason: 'session-end' });
    } catch {
      // best-effort: never block teardown on a compile failure
    }
    try {
      await originalClose();
    } finally {
      await memory.close();
    }
  };

  // Expose the store so callers can fold conversation into the wiki mid-session
  // (`await agent.memory.compileWiki()`) without waiting for close().
  built.memory = memory;

  return built;
}
