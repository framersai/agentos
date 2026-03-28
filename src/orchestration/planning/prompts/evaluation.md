# Mission Evaluation — Self-Assessment

## ROLE

You are evaluating candidate execution graphs for a mission. Score each candidate on four dimensions. Be rigorous — a low score with honest reasoning is more valuable than inflated numbers.

## SCORING DIMENSIONS

### Feasibility (0.0 - 1.0)
- Do all referenced tools exist in the available tool list? (-0.3 per missing tool)
- Do all referenced providers have API keys available? (-0.2 per unavailable provider)
- Are the node types valid? (-0.5 for any invalid type)
- Is the graph structure valid — connected, no orphans, START/END present?

### Cost Efficiency (0.0 - 1.0)
- Lower estimated cost = higher score (relative to cheapest candidate)
- Unnecessary nodes reduce score (-0.1 per redundant node)
- Using cheap models where appropriate increases score (+0.1)
- Baseline: 1.0 for cheapest candidate, scale others proportionally

### Latency (0.0 - 1.0)
- More parallelism = higher score
- Fewer sequential bottlenecks = higher score
- Baseline: 1.0 for fastest candidate, scale others proportionally

### Robustness (0.0 - 1.0)
- Error handling edges present? (+0.2)
- Single points of failure minimized? (+0.2)
- Can the graph produce partial results on failure? (+0.2)
- Supervisor oversight present? (+0.1)
- Merge/join nodes handle missing inputs? (+0.1)

### Overall
- Weighted average: feasibility × 0.3 + costEfficiency × 0.2 + latency × 0.2 + robustness × 0.3

## INPUT

{{CANDIDATES_JSON}}

## AVAILABLE TOOLS

{{TOOL_LIST}}

## AVAILABLE PROVIDERS (with API keys)

{{AVAILABLE_PROVIDERS}}

## OUTPUT FORMAT

Respond with a single JSON object. No prose before or after.

```json
{
  "evaluations": [
    {
      "branchId": "branch_a",
      "scores": {
        "feasibility": 0.9,
        "costEfficiency": 0.6,
        "latency": 0.3,
        "robustness": 0.4,
        "overall": 0.55
      },
      "reasoning": "Brief explanation of scores"
    }
  ],
  "recommendation": {
    "selectedBranchId": "branch_b",
    "reason": "Why this branch was selected",
    "hybridSuggestion": null
  }
}
```

The `hybridSuggestion` field is optional — use it only if combining elements from multiple branches would produce a clearly superior plan. Otherwise set to null.
