
---

## References

### DAG workflow engines

- Apache Airflow contributors. *Apache Airflow: Programmatically author, schedule and monitor workflows.* — Reference DAG-execution semantics that informed `workflow()`'s topological-sort + tier-execution model. [airflow.apache.org](https://airflow.apache.org/)
- Prefect contributors. *Prefect: The new standard in dataflow automation.* — Modern Python workflow engine with similar fail-fast and resume semantics. [prefect.io](https://www.prefect.io/)
- Temporal contributors. *Temporal: Microservices orchestration platform.* — Durable-execution patterns informing the checkpointing + resume design shared with `mission()` and `AgentGraph`. [temporal.io](https://temporal.io/)

### LLM-pipeline composition

- Khattab, O., Singhvi, A., Maheshwari, P., Zhang, Z., Santhanam, K., Vardhamanan, S., Haq, S., Sharma, A., Joshi, T., Moazam, H., Miller, H., Zaharia, M., & Potts, C. (2023). *DSPy: Compiling declarative language model calls into self-improving pipelines.* arXiv preprint. — The "compile-then-run" approach to LLM pipelines that informed the `CompiledExecutionGraph` IR design. [arXiv:2310.03714](https://arxiv.org/abs/2310.03714)

### Implementation references

- `packages/agentos/src/orchestration/builders/WorkflowBuilder.ts` — `workflow()` factory + chain builder
- `packages/agentos/src/orchestration/compiler/CompiledExecutionGraph.ts` — shared IR
