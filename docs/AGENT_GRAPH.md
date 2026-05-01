
---

## References

### Graph-structured agent orchestration

- Wu, Q., Bansal, G., Zhang, J., Wu, Y., Li, B., Zhu, E., Jiang, L., Zhang, X., Zhang, S., Liu, J., Awadallah, A. H., White, R. W., Burger, D., & Wang, C. (2023). *AutoGen: Enabling next-gen LLM applications via multi-agent conversation.* arXiv preprint. — Conversation-graph patterns that informed the `gmi` node + `delegate_to` edge semantics. [arXiv:2308.08155](https://arxiv.org/abs/2308.08155)
- LangGraph contributors. *LangGraph: A library for building stateful, multi-actor applications with LLMs.* — Reference architecture for stateful graph orchestration with cycles and conditional branches; AgentGraph deliberately differs in the edge taxonomy (adds discovery + personality edges). [GitHub](https://github.com/langchain-ai/langgraph)

### Conditional + cyclic state machines

- Harel, D. (1987). *Statecharts: A visual formalism for complex systems.* *Science of Computer Programming*, 8(3), 231–274. — The state-machine formalism behind cyclic agent loops with conditional transitions. [DOI](https://doi.org/10.1016/0167-6423(87)90035-9)

### State reducers (functional + applied)

- Abramov, D. (2015). *Redux: A predictable state container.* — The reducer pattern AgentGraph's per-field state-merge strategies follow (concat, replace, max, etc.). [redux.js.org](https://redux.js.org/)

### Implementation references

- `packages/agentos/src/orchestration/builders/AgentGraph.ts` — the AgentGraph class
- `packages/agentos/src/orchestration/builders/nodes.ts` — `gmiNode`, `toolNode`, `humanNode`, `routerNode`, `guardrailNode`, `subgraphNode`, `judgeNode` factories
- `packages/agentos/src/orchestration/ir/` — shared IR types (`START`, `END`, edges, reducers)
