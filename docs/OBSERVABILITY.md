# Observability (OpenTelemetry)

AgentOS supports opt-in OpenTelemetry (OTEL) spans and correlation helpers.

Defaults:

- Manual AgentOS spans: OFF
- AgentOS metrics: OFF
- Trace IDs in responses: OFF
- Log correlation (`trace_id`, `span_id`): OFF

## Enable via Config

```ts
import { AgentOS } from '@framers/agentos';

const agentos = new AgentOS();
await agentos.initialize({
  // ...existing required config...
  observability: {
    metrics: { enabled: true },
    tracing: { enabled: true, includeTraceInResponses: true },
    logging: { includeTraceIds: true },
  },
});
```

## Enable via Env

```bash
AGENTOS_OBSERVABILITY_ENABLED=true
AGENTOS_METRICS_ENABLED=true
AGENTOS_TRACE_IDS_IN_RESPONSES=true
AGENTOS_LOG_TRACE_IDS=true
```

## What Gets Emitted

Spans (when enabled):

- `agentos.turn`
- `agentos.gmi.get_or_create`
- `agentos.gmi.process_turn_stream`
- `agentos.tool_result`
- `agentos.gmi.handle_tool_result`
- `agentos.conversation.save` (stage-tagged)

Privacy:

- Prompts, model outputs, and tool arguments are not recorded by default.

## Metrics (When Enabled)

Metrics:

- `agentos.turns`
- `agentos.turn.duration_ms`
- `agentos.turn.tokens.*`
- `agentos.turn.cost.usd`
- `agentos.tool_results`
- `agentos.tool_result.duration_ms`

## Host App Requirement

AgentOS uses `@opentelemetry/api` only. The host application is responsible for installing and starting an OTEL SDK (NodeSDK in Node, web SDK in browsers) and configuring exporters/sampling.

Backend example in this repo: `backend/src/observability/otel.ts`.
