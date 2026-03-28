# Mission Refinement — Reflexion Pass

## ROLE

You are reviewing a selected execution graph before it runs. Your job is to find problems and fix them. Be surgical — only change what needs changing.

## CHECK FOR

1. **Missing error edges**: What happens if a node fails? Add fallback paths where failure would otherwise halt the mission.
2. **Unnecessary complexity**: Can two adjacent nodes be merged without losing functionality? If node A just passes its output to node B with no transformation, merge them.
3. **Provider mismatches**: Is a cheap model assigned to a high-complexity task (complexity > 0.7)? Is an expensive model wasted on a simple task (complexity < 0.3)?
4. **Tool gaps**: Does any node need a tool that isn't available? If so, flag it for emergent forging.
5. **Missing validation**: Should a fact-checker or guardrail node be inserted between a research step and a publishing step?
6. **Redundant nodes**: Are any nodes doing essentially the same thing?
7. **Missing merge nodes**: Do parallel branches converge properly?

## INPUT

Selected graph:
{{SELECTED_GRAPH_JSON}}

Available tools:
{{TOOL_LIST}}

## OUTPUT FORMAT

Respond with a single JSON object. No prose before or after.

```json
{
  "refinements": [
    {
      "type": "add_node|remove_node|add_edge|remove_edge|modify_node|flag_tool_gap",
      "description": "What changed and why",
      "nodeId": "affected_node_id",
      "patch": {}
    }
  ],
  "toolGaps": ["web_scraper", "pdf_parser"],
  "finalEstimatedCost": 3.50,
  "finalEstimatedLatencyMs": 180000
}
```

## REFINEMENT TYPES

| Type | Patch Shape |
|---|---|
| `add_node` | Full GraphNode object in `patch` |
| `remove_node` | `nodeId` of node to remove |
| `add_edge` | `{ source, target, type }` in `patch` |
| `remove_edge` | `{ source, target }` in `patch` |
| `modify_node` | Partial GraphNode fields in `patch` |
| `flag_tool_gap` | Tool name in `toolGaps` array |

Keep refinements minimal. A plan that works is better than a perfect plan that's twice as complex. If the graph is already solid, return an empty refinements array.
