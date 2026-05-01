
---

## References

### Reasoning + acting in language models

- Yao, S., Zhao, J., Yu, D., Du, N., Shafran, I., Narasimhan, K., & Cao, Y. (2023). *ReAct: Synergizing reasoning and acting in language models.* ICLR 2023. — The reasoning-and-acting loop the planner uses for plan-execute-reflect cycles. [arXiv:2210.03629](https://arxiv.org/abs/2210.03629)
- Yao, S., Yu, D., Zhao, J., Shafran, I., Griffiths, T. L., Cao, Y., & Narasimhan, K. (2023). *Tree of thoughts: Deliberate problem solving with large language models.* NeurIPS 2023. — Tree-of-thought search over planning branches; informs the multi-strategy planner config. [arXiv:2305.10601](https://arxiv.org/abs/2305.10601)
- Wei, J., Wang, X., Schuurmans, D., Bosma, M., Ichter, B., Xia, F., Chi, E. H., Le, Q. V., & Zhou, D. (2022). *Chain-of-thought prompting elicits reasoning in large language models.* NeurIPS 2022. — Foundational chain-of-thought work behind step-by-step decomposition prompts. [arXiv:2201.11903](https://arxiv.org/abs/2201.11903)
- Shinn, N., Cassano, F., Gopinath, A., Narasimhan, K., & Yao, S. (2023). *Reflexion: Language agents with verbal reinforcement learning.* NeurIPS 2023. — Self-reflection loop after plan execution; informs the reflect-and-replan path. [arXiv:2303.11366](https://arxiv.org/abs/2303.11366)

### Hierarchical task decomposition

- Hong, S., Zhuge, M., Chen, J., Zheng, X., Cheng, Y., Zhang, C., Wang, J., Wang, Z., Yau, S. K. S., Lin, Z., Zhou, L., Ran, C., Xiao, L., Wu, C., & Schmidhuber, J. (2023). *MetaGPT: Meta programming for a multi-agent collaborative framework.* ICLR 2024. — LLM-driven goal decomposition into subtasks; informs the planner's task-graph generation. [arXiv:2308.00352](https://arxiv.org/abs/2308.00352)
- Schick, T., Dwivedi-Yu, J., Dessì, R., Raileanu, R., Lomeli, M., Zettlemoyer, L., Cancedda, N., & Scialom, T. (2023). *Toolformer: Language models can teach themselves to use tools.* NeurIPS 2023. — Tool-selection methodology the planner uses when assigning tools to plan steps. [arXiv:2302.04761](https://arxiv.org/abs/2302.04761)

### Plan validation + execution

- Liu, B., Jiang, Y., Zhang, X., Liu, Q., Zhang, S., Biswas, J., & Stone, P. (2023). *LLM+P: Empowering large language models with optimal planning proficiency.* arXiv preprint. — PDDL-style plan validation; informs the planner's plan-correctness gate. [arXiv:2304.11477](https://arxiv.org/abs/2304.11477)
- Valmeekam, K., Marquez, M., Sreedharan, S., & Kambhampati, S. (2023). *On the planning abilities of large language models: A critical investigation.* NeurIPS 2023. — Honest analysis of LLM planning failure modes; motivates the validate-before-execute and reflect-on-failure design choices. [arXiv:2305.15771](https://arxiv.org/abs/2305.15771)

### Implementation references

- `packages/agentos/src/orchestration/planner/PlanningEngine.ts` — main planner class with ReAct + plan-execute-reflect loops
- `packages/agentos/src/orchestration/planner/` — plan generation, decomposition, refinement, validation
- `packages/agentos/src/orchestration/turn-planner/` — per-turn planning telemetry
