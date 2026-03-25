# Emergent Capabilities

Agents with `emergent: true` can forge new tools at runtime when no existing capability fits the task.

## What exists today

- `compose` mode: chain existing tools through a small step DSL
- `sandbox` mode: run bounded JavaScript in a restricted VM
- `forge_tool`: meta-tool exposed to emergent-enabled agents
- LLM-as-judge review on creation
- schema validation on reuse
- tiered lifecycle:
  - `session`: ephemeral, mirrored to persistence when available for inspection
  - `agent`: persisted for the creating agent
  - `shared`: broader visibility, intended for human-reviewed promotion

## Safety model

- static code validation rejects `eval`, `Function`, `require`, `process`, dynamic `import`, and write-side `fs` calls
- sandbox execution enforces timeout and API allowlists
- optional `fetch`, `fs.readFile`, and `crypto` access only when explicitly allowlisted
- output reuse is schema-checked on every invocation

## Current boundaries

- `compose` tools are the safest default because they only orchestrate already-registered tools
- sandboxed tools are bounded, but still conservative: unsupported Node APIs remain blocked and filesystem reads are root-restricted
- persistence-backed inspection exists, but live discovery/promotion behavior still depends on the active runtime wiring the emergent engine into the tool/discovery stack

## AgentOS config

```ts
import { AgentOS } from '@framers/agentos';

const agent = new AgentOS();

await agent.initialize({
  emergent: true,
  emergentConfig: {
    maxSessionTools: 10,
    maxAgentTools: 50,
    sandboxTimeoutMs: 5000,
    sandboxMemoryMB: 128,
    judgeModel: 'gpt-4o-mini',
    promotionJudgeModel: 'gpt-4o',
  },
});
```

## Forge request shape

`forge_tool` accepts two implementation modes:

### Compose

```json
{
  "name": "search_and_summarize",
  "description": "Search, then summarize results",
  "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] },
  "implementation": {
    "mode": "compose",
    "steps": [
      { "name": "search", "tool": "web_search", "inputMapping": { "q": "$input.query" } },
      { "name": "summarize", "tool": "summarize_text", "inputMapping": { "text": "$prev.output" } }
    ]
  },
  "testCases": [{ "input": { "query": "agent orchestration" } }]
}
```

### Sandbox

```json
{
  "name": "add_numbers",
  "description": "Add two numbers",
  "inputSchema": { "type": "object", "properties": { "a": { "type": "number" }, "b": { "type": "number" } }, "required": ["a", "b"] },
  "outputSchema": { "type": "object", "properties": { "sum": { "type": "number" } }, "required": ["sum"] },
  "implementation": {
    "mode": "sandbox",
    "code": "function execute(input) { return { sum: input.a + input.b }; }",
    "allowlist": []
  },
  "testCases": [{ "input": { "a": 2, "b": 3 } }]
}
```

## Operational notes

- If no LLM callback is configured for the judge, creation review fails closed.
- Session cleanup removes ephemeral tools from the live orchestrator and from the mirrored persistence rows.
- Persisted metadata is suitable for audit, dashboards, and CLI inspection; it is not a substitute for runtime activation.
