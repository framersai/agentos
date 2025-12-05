# Changelog

All notable changes to this project will be documented here by [semantic-release](https://semantic-release.gitbook.io).

---

## [1.1.0] - 2024-12-05

### ✨ Features

#### Planning Engine
- **Multi-step execution plans**: Generate structured plans from high-level goals
- **Task decomposition**: Break complex tasks into manageable subtasks
- **Plan refinement**: Adapt plans based on execution feedback
- **Autonomous loops**: Continuous plan-execute-reflect cycles (ReAct pattern)
- **Confidence scoring**: Track plan reliability metrics

#### Human-in-the-Loop (HITL)
- **Approval system**: Request human approval for high-risk actions with severity levels
- **Clarification requests**: Resolve ambiguous situations with options or freeform input
- **Output review**: Submit drafts for human editing before finalization
- **Escalation handling**: Transfer control to humans when uncertain
- **Workflow checkpoints**: Progress reviews during long-running tasks
- **Feedback collection**: Record human corrections for agent learning
- **Notification handlers**: Extensible system for Slack, email, webhooks

#### Agent Communication Bus
- **Direct messaging**: Point-to-point communication between agents
- **Broadcasting**: Send messages to all agents in an agency
- **Topic pub/sub**: Subscribe to channels for specific message types
- **Request/response**: Query agents and await responses with timeouts
- **Structured handoffs**: Transfer context and responsibility between agents
- **Message history**: Track communication for auditing and context

#### Extensions System
- New extension kinds: `planning-strategy`, `hitl-handler`, `communication-channel`, `memory-provider`
- Custom planning strategies can override default behavior
- Pluggable notification handlers for HITL
- Distributed communication channels (Redis, WebSocket)
- Custom memory providers (Pinecone, Weaviate, Qdrant)

### 🏗️ Backend API
- `/api/agentos/planning/*` - Plan management endpoints
- `/api/agentos/hitl/*` - Human-in-the-loop endpoints

### 📚 Documentation
- Added `PLANNING_ENGINE.md` - Comprehensive planning guide
- Added `HUMAN_IN_THE_LOOP.md` - HITL usage guide
- Added `AGENT_COMMUNICATION.md` - Inter-agent messaging guide
- Updated `ARCHITECTURE.md` with new components

### 🖥️ Workbench UI
- **PlanningDashboard**: Visualize plans, steps, and execution progress
- **HumanInteractionDashboard**: Manage approvals, clarifications, escalations

---

## [1.0.0] - 2024-11-XX

### Features
- Initial release with GMI Core, RAG Memory, Agencies, Extensions
- See `ARCHITECTURE.md` for full documentation

***

