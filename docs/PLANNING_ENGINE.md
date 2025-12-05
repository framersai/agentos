# AgentOS Planning Engine

The Planning Engine is a core component of AgentOS that enables autonomous goal pursuit, task decomposition, and self-correcting execution plans using cognitive patterns like ReAct (Reasoning + Acting).

## Overview

The Planning Engine provides sophisticated cognitive capabilities for autonomous agents:

- **Goal Decomposition**: Break complex goals into manageable subtasks
- **Plan Generation**: Create multi-step execution plans with various strategies
- **Self-Correction**: Refine plans based on execution feedback
- **Autonomous Loops**: Pursue goals with minimal human intervention

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PlanningEngine                                │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ Plan Generator  │  │  Task Decomposer │  │  Self-Reflector │     │
│  │ (ReAct, ToT)    │  │  (Least-to-Most) │  │  (Reflexion)    │     │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │
│           │                    │                    │               │
│           └────────────────────┼────────────────────┘               │
│                                │                                    │
│  ┌─────────────────────────────▼─────────────────────────────────┐ │
│  │                    Execution Engine                            │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │ │
│  │  │ Step     │  │ Checkpoint│  │ Rollback │  │ Autonomous│       │ │
│  │  │ Executor │  │ Manager  │  │ Handler  │  │ Loop     │       │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
            ┌───────▼───────┐ ┌──▼──┐ ┌──────▼──────┐
            │ LLM Provider  │ │Tools│ │ RAG System  │
            │ Manager       │ │     │ │             │
            └───────────────┘ └─────┘ └─────────────┘
```

## Planning Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| `react` | Interleaved Reasoning + Acting | Dynamic tasks requiring adaptation |
| `plan_and_execute` | Full plan upfront, then execute | Well-defined tasks |
| `tree_of_thought` | Explore multiple reasoning paths | Complex reasoning problems |
| `least_to_most` | Decompose into simpler subproblems | Incrementally solvable tasks |
| `self_consistency` | Generate multiple plans, vote on best | High-stakes decisions |
| `reflexion` | Plan with self-reflection loops | Learning from mistakes |

## Usage

### Basic Plan Generation

```typescript
import { PlanningEngine } from '@framers/agentos/core/planning';

const engine = new PlanningEngine({
  llmProvider: aiModelProviderManager,
  defaultModelId: 'gpt-4-turbo',
});

const plan = await engine.generatePlan(
  'Analyze customer feedback and generate insights report',
  { domainContext: 'E-commerce platform' },
  { strategy: 'react', maxSteps: 15 }
);
```

### Task Decomposition

```typescript
const decomposition = await engine.decomposeTask(
  'Build a REST API with authentication and rate limiting',
  3 // max depth
);

console.log(decomposition.subtasks);
// [
//   { description: 'Design API endpoints schema', complexity: 3 },
//   { description: 'Implement authentication middleware', complexity: 5 },
//   { description: 'Add rate limiting logic', complexity: 4 },
//   ...
// ]
```

### Autonomous Goal Pursuit

```typescript
for await (const progress of engine.runAutonomousLoop('Research AI safety papers', {
  maxIterations: 20,
  goalConfidenceThreshold: 0.9,
  enableReflection: true,
  onApprovalRequired: async (request) => {
    // Human-in-the-loop checkpoint
    return confirm(`Approve: ${request.step.action.content}?`);
  },
})) {
  console.log(`Progress: ${(progress.progress * 100).toFixed(1)}%`);
  console.log(`Current: ${progress.currentStep.action.content}`);
}
```

### Plan Refinement

```typescript
// After a step fails
const refinedPlan = await engine.refinePlan(plan, {
  planId: plan.planId,
  stepId: failedStep.stepId,
  feedbackType: 'step_failed',
  details: 'API rate limit exceeded',
  severity: 'error',
});
```

## Integration with Agencies

The Planning Engine integrates with AgentOS Agencies for multi-agent planning:

```typescript
import { AgencyRegistry, AgentCommunicationBus } from '@framers/agentos';

// Coordinator agent generates plan
const plan = await planningEngine.generatePlan('Complete quarterly report');

// Delegate steps to specialist agents
for (const step of plan.steps) {
  if (step.action.type === 'tool_call') {
    await communicationBus.sendToRole(agencyId, 'specialist', {
      type: 'task_delegation',
      content: step,
      priority: 'high',
    });
  }
}
```

## Checkpointing & Recovery

```typescript
// Save checkpoint
const checkpointId = await engine.saveCheckpoint(plan, currentState);

// Restore after failure
const { plan: restoredPlan, state: restoredState } = 
  await engine.restoreCheckpoint(checkpointId);
```

## Key Interfaces

### ExecutionPlan

```typescript
interface ExecutionPlan {
  planId: string;
  goal: string;
  steps: PlanStep[];
  dependencies: Map<string, string[]>;
  estimatedTokens: number;
  confidenceScore: number;
  strategy: PlanningStrategy;
}
```

### PlanStep

```typescript
interface PlanStep {
  stepId: string;
  action: PlanAction;
  reasoning: string;
  expectedOutcome: string;
  dependsOn: string[];
  confidence: number;
  requiresHumanApproval: boolean;
}
```

See `IPlanningEngine.ts` for complete type definitions.


