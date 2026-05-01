
---

## References

### OpenTelemetry

- W3C. (2021). *Trace Context Level 1.* W3C Recommendation. — The W3C standard for distributed-trace context propagation across process boundaries; AgentOS uses it to correlate spans across microservices. [w3.org/TR/trace-context-1](https://www.w3.org/TR/trace-context-1/)
- OpenTelemetry Specification (current). *OpenTelemetry signal specifications: traces, metrics, and logs.* — The protocol contract AgentOS emits against. [opentelemetry.io/docs/specs/otel](https://opentelemetry.io/docs/specs/otel/)
- OpenTelemetry. (current). *Semantic conventions.* — Naming and attribute schema for spans/metrics/logs; AgentOS follows the GenAI semantic conventions for LLM-call attributes. [opentelemetry.io/docs/specs/semconv](https://opentelemetry.io/docs/specs/semconv/)
- OpenTelemetry GenAI working group. (current). *Generative AI semantic conventions.* — The schema for `gen_ai.*` attributes (request.model, usage.input_tokens, etc.) AgentOS sets on LLM-call spans. [opentelemetry.io/docs/specs/semconv/gen-ai](https://opentelemetry.io/docs/specs/semconv/gen-ai/)

### Distributed tracing foundations

- Sigelman, B. H., Barroso, L. A., Burrows, M., Stephenson, P., Plakal, M., Beaver, D., Jaspan, S., & Shanbhag, C. (2010). *Dapper, a large-scale distributed systems tracing infrastructure.* Google Technical Report. — The original distributed-tracing paper that defined the span/trace abstractions used today. [Google Research](https://research.google/pubs/dapper-a-large-scale-distributed-systems-tracing-infrastructure/)
- Mace, J., Roelke, R., & Fonseca, R. (2015). *Pivot tracing: Dynamic causal monitoring for distributed systems.* SOSP 2015. — Causal monitoring methodology informing the trace-id propagation through `AgentOSResponse` metadata. [DOI](https://doi.org/10.1145/2815400.2815415)

### Logging

- OpenTelemetry. (current). *OpenTelemetry logging specification.* — The bridge spec connecting `LogRecord` events to span context; AgentOS's optional `exportToOtel` log path follows it. [opentelemetry.io/docs/specs/otel/logs](https://opentelemetry.io/docs/specs/otel/logs/)
- Pino contributors. (current). *Pino: Very low overhead Node.js logger.* — The logger AgentOS wraps via `PinoLogger`; chosen for its sub-microsecond per-line cost in hot paths. [GitHub](https://github.com/pinojs/pino)

### Implementation references

- `packages/agentos/src/evaluation/observability/Tracer.ts` — span creation around turn / tool / guardrail / LLM-call boundaries
- `packages/agentos/src/evaluation/observability/otel.ts` — OpenTelemetry API peer-dep wiring
- `packages/agentos/src/logging/PinoLogger.ts` — structured logger with trace-id / span-id field injection
- `packages/agentos/src/evaluation/SqlTaskOutcomeTelemetryStore.ts` — persisted per-turn outcome KPIs for rolling-quality dashboards
