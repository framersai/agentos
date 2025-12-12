# AgentOS Architecture Deep Dive

## Overview

AgentOS is a cognitive AI agent framework that implements **Generalized Mind Instances (GMIs)** - adaptive, context-aware AI entities capable of autonomous reasoning, tool use, memory management, and multi-agent collaboration.

---

## Core Concepts

### 1. GMI (Generalized Mind Instance)

A GMI is the fundamental cognitive unit in AgentOS. Think of it as an "AI brain" that can:

```
┌─────────────────────────────────────────────────────────────────┐
│                        GMI Instance                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐    │
│  │  Persona  │  │  Working  │  │  Tool     │  │   LLM     │    │
│  │Definition │  │  Memory   │  │Orchestratr│  │ Provider  │    │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘    │
│        │              │              │              │           │
│        └──────────────┴──────────────┴──────────────┘           │
│                              │                                   │
│                    ┌─────────▼─────────┐                        │
│                    │  processTurnStream │                        │
│                    │  (Main Loop)       │                        │
│                    └─────────┬─────────┘                        │
│                              │                                   │
│        ┌─────────────────────┼─────────────────────┐            │
│        ▼                     ▼                     ▼            │
│  ┌───────────┐       ┌───────────┐         ┌───────────┐       │
│  │  Reason   │       │ Execute   │         │  Reflect  │       │
│  │  & Plan   │       │   Tools   │         │  & Learn  │       │
│  └───────────┘       └───────────┘         └───────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

**Key GMI Components:**

| Component | Purpose |
|-----------|---------|
| **Persona** | Identity, personality, system prompt, allowed tools/capabilities |
| **Working Memory** | Short-term context window for current conversation |
| **Tool Orchestrator** | Executes tools (APIs, code, file operations) |
| **LLM Provider** | Connection to OpenAI, Anthropic, local models, etc. |
| **RAG Augmentor** | Long-term memory via vector search |
| **Utility AI** | JSON parsing, summarization, structured extraction |

**GMI Lifecycle States:**

```
IDLE → PROCESSING → [AWAITING_TOOL_RESULT → PROCESSING] → IDLE
                  → ERROR → IDLE
```

### 2. Persona

A Persona defines the **identity and constraints** of a GMI:

```typescript
interface IPersonaDefinition {
  id: string;
  name: string;
  systemMessage: string;         // Core personality/instructions
  allowedTools: string[];        // Which tools this persona can use
  allowedCapabilities: string[]; // Permissions (e.g., 'code_execution')
  defaultProviderId: string;     // Default LLM (openai, anthropic, etc.)
  defaultModelId: string;        // Default model (gpt-4o, claude-3, etc.)
  ragConfig?: PersonaRagConfig;  // Memory configuration
  metaPrompts?: MetaPromptDefinition[]; // Self-reflection triggers
}
```

### 3. Agency (Multi-Agent Collective)

An Agency is a **team of GMIs** working together with shared context:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Agency                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  Shared Memory (RAG)                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│       ┌──────────────────────┼──────────────────────┐           │
│       ▼                      ▼                      ▼           │
│  ┌─────────┐           ┌─────────┐            ┌─────────┐      │
│  │  GMI    │           │  GMI    │            │  GMI    │      │
│  │(Researcher)         │(Analyst)│            │(Writer) │      │
│  │  Seat 1 │◄─────────►│ Seat 2  │◄──────────►│ Seat 3  │      │
│  └─────────┘    Comm   └─────────┘    Comm    └─────────┘      │
│       │         Bus          │         Bus          │           │
│       └──────────────────────┴──────────────────────┘           │
│              Agent Communication Bus                             │
└─────────────────────────────────────────────────────────────────┘
```

**Agency Features:**
- **Seats**: Roles filled by specific GMI instances
- **Shared Memory**: RAG-backed collective knowledge
- **Communication Bus**: Message passing between GMIs
- **Handoffs**: Structured transfer of context between GMIs

---

## Plans vs Workflows: The Key Distinction

### Workflows: Declarative Blueprints

**Workflows** are **pre-defined, static process definitions**. They represent known, repeatable procedures.

```typescript
// A Workflow Definition (static, designed by humans)
const reviewWorkflow: WorkflowDefinition = {
  id: 'code-review-workflow',
  displayName: 'Code Review Process',
  tasks: [
    {
      id: 'analyze-code',
      name: 'Analyze Code',
      executor: { type: 'gmi', roleId: 'senior-dev' },
      dependsOn: [],
    },
    {
      id: 'security-scan',
      name: 'Security Scan',
      executor: { type: 'tool', extensionId: 'security-scanner' },
      dependsOn: [],
    },
    {
      id: 'write-review',
      name: 'Write Review Summary',
      executor: { type: 'gmi', roleId: 'reviewer' },
      dependsOn: ['analyze-code', 'security-scan'],
    },
    {
      id: 'human-approval',
      name: 'Manager Approval',
      executor: { type: 'human' },
      dependsOn: ['write-review'],
    },
  ],
};
```

**Workflow Characteristics:**
| Aspect | Description |
|--------|-------------|
| **Structure** | Predefined DAG (Directed Acyclic Graph) |
| **Creation** | Designed by humans at development time |
| **Execution** | WorkflowRuntime orchestrates task execution |
| **Flexibility** | Static - same tasks run every time |
| **Use Case** | Repeatable business processes |

### Plans: Dynamic Goal Pursuit

**Plans** are **dynamically generated** by the LLM to achieve a novel goal.

```typescript
// A Plan (dynamic, generated by AI at runtime)
const plan: ExecutionPlan = {
  planId: 'plan-abc123',
  goal: 'Build a weather dashboard web app',
  strategy: 'react', // ReAct pattern
  steps: [
    {
      stepId: 'step-1',
      action: {
        type: 'information_gathering',
        content: 'Research weather APIs available',
      },
      reasoning: 'Need to find data source first',
    },
    {
      stepId: 'step-2',
      action: {
        type: 'tool_call',
        toolId: 'code-sandbox',
        toolArgs: { language: 'javascript', code: '...' },
      },
      reasoning: 'Create basic HTML structure',
      dependsOn: ['step-1'],
    },
    // ... more steps generated dynamically
  ],
  confidenceScore: 0.85,
};
```

**Plan Characteristics:**
| Aspect | Description |
|--------|-------------|
| **Structure** | Generated dynamically from goal |
| **Creation** | AI generates at runtime |
| **Execution** | PlanningEngine executes with self-correction |
| **Flexibility** | Adaptive - can re-plan based on feedback |
| **Use Case** | Novel, open-ended tasks |

### Comparison Table

| Feature | Workflow | Plan |
|---------|----------|------|
| **Definition Time** | Development | Runtime |
| **Defined By** | Human developer | LLM |
| **Structure** | Fixed DAG | Dynamic |
| **Self-Correction** | ❌ | ✅ (via reflection) |
| **Strategies** | N/A | ReAct, Plan-and-Execute, Tree-of-Thought |
| **Best For** | Known processes | Open-ended goals |
| **Multi-Agent** | ✅ (via roles) | ✅ (via sub-plans) |

### When to Use Each

**Use Workflows when:**
- You have a well-defined process
- Compliance/audit trails are required
- Multiple actors (GMIs, humans, tools) need coordination
- The process rarely changes

**Use Plans when:**
- The goal is novel/undefined
- The approach needs to be discovered
- Self-correction is important
- The task is one-off or exploratory

---

## Today's Enhancements

### 1. Code Execution Sandbox
```
┌──────────────────────────────────────┐
│         CodeSandbox                   │
├──────────────────────────────────────┤
│ • Multi-language (JS, Python, SQL)   │
│ • Security validation                 │
│ • Execution history tracking          │
│ • Context variable injection          │
│ • Timeout handling                    │
└──────────────────────────────────────┘
```

### 2. Observability/Tracing
```
┌──────────────────────────────────────┐
│         Tracer                        │
├──────────────────────────────────────┤
│ • OpenTelemetry-compatible spans     │
│ • W3C Trace Context propagation      │
│ • Event recording & attributes       │
│ • Multiple exporters                 │
│ • withSpan() helper                  │
└──────────────────────────────────────┘
```

### 3. Evaluation Framework
```
┌──────────────────────────────────────┐
│         Evaluator                     │
├──────────────────────────────────────┤
│ • Built-in scorers (BLEU, ROUGE)     │
│ • Custom scorer registration          │
│ • Test case evaluation                │
│ • Run comparison & regression         │
│ • Report generation (JSON/MD/HTML)   │
└──────────────────────────────────────┘
```

---

## The Complete AgentOS Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                     User Application                             │
├─────────────────────────────────────────────────────────────────┤
│                   AgentOS Orchestrator                           │
│  ┌─────────────┬─────────────┬─────────────┬───────────────┐    │
│  │  GMIManager │WorkflowEngine│PlanningEngine│HumanInteraction│   │
│  └─────────────┴─────────────┴─────────────┴───────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│                    Core Services                                 │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐       │
│  │Tool      │LLM       │RAG       │Streaming │Tracing   │       │
│  │Orchestratr│Providers │System    │Manager   │(Observ.) │       │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘       │
├─────────────────────────────────────────────────────────────────┤
│                    Extensions Layer                              │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐       │
│  │Code      │Guardrails│Structured│Evaluation│Custom    │       │
│  │Sandbox   │          │Outputs   │Framework │Extensions│       │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘       │
├─────────────────────────────────────────────────────────────────┤
│                    Storage Layer                                 │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  sql-storage-adapter (SQLite/PostgreSQL/IndexedDB)   │       │
│  └──────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Summary

| Concept | What It Is | Purpose |
|---------|------------|---------|
| **GMI** | Single AI mind instance | Core cognitive unit |
| **Persona** | Identity configuration | Defines behavior/constraints |
| **Agency** | Multi-GMI collective | Team collaboration |
| **Workflow** | Static process definition | Repeatable known processes |
| **Plan** | Dynamic goal pursuit | Novel/exploratory tasks |
| **Tool** | External capability | Code execution, API calls, etc. |
| **RAG** | Long-term memory | Persistent knowledge retrieval |
| **HITL** | Human-in-the-loop | Human oversight/intervention |

