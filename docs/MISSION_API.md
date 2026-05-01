
---

## References

### Goal-first authoring patterns

- Yao, S., Zhao, J., Yu, D., Du, N., Shafran, I., Narasimhan, K., & Cao, Y. (2023). *ReAct: Synergizing reasoning and acting in language models.* ICLR 2023. — Reasoning-and-acting pattern the `react` planner strategy targets. [arXiv:2210.03629](https://arxiv.org/abs/2210.03629)
- Yao, S., Yu, D., Zhao, J., Shafran, I., Griffiths, T. L., Cao, Y., & Narasimhan, K. (2023). *Tree of thoughts: Deliberate problem solving with large language models.* NeurIPS 2023. — Branch-and-evaluate planning pattern informing the `tree` planner strategy. [arXiv:2305.10601](https://arxiv.org/abs/2305.10601)
- Hong, S., Zhuge, M., Chen, J., et al. (2023). *MetaGPT: Meta programming for a multi-agent collaborative framework.* ICLR 2024. — Hierarchical task decomposition informing the `hierarchical` planner strategy. [arXiv:2308.00352](https://arxiv.org/abs/2308.00352)

### Implementation references

- `packages/agentos/src/orchestration/builders/MissionBuilder.ts` — the `mission()` factory + builder
- `packages/agentos/src/orchestration/compiler/` — IR + graph compiler shared with `workflow()` and `AgentGraph`
