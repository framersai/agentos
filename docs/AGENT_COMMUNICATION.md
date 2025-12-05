# AgentOS Agent Communication Bus

The Agent Communication Bus enables structured messaging between GMIs within an agency, supporting various communication patterns for multi-agent collaboration.

## Overview

The Communication Bus provides:

- **Point-to-Point Messaging**: Direct messages between two agents
- **Broadcast**: Messages to all agents in an agency
- **Request-Response**: Synchronous-style communication
- **Pub/Sub**: Topic-based messaging
- **Handoff**: Structured task transfer between agents

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AgentCommunicationBus                            │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Message Router                            │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │   │
│  │  │ Point-to │  │ Role-    │  │ Topic    │  │ Load     │    │   │
│  │  │ -Point   │  │ Based    │  │ Router   │  │ Balancer │    │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│  ┌───────────────────────────▼───────────────────────────────────┐ │
│  │                 Subscription Manager                           │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │ │
│  │  │ Agent Subs   │  │ Topic Subs   │  │ Filters      │        │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘        │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                              │                                      │
│  ┌───────────────────────────▼───────────────────────────────────┐ │
│  │                 Delivery Manager                               │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │ │
│  │  │ Queue    │  │ Retry    │  │ ACK      │  │ History  │      │ │
│  │  │ Manager  │  │ Handler  │  │ Tracker  │  │ Store    │      │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## Message Types

| Type | Description | Use Case |
|------|-------------|----------|
| `task_delegation` | Delegate a task to another agent | Work distribution |
| `status_update` | Update on task progress | Progress tracking |
| `question` | Ask another agent a question | Information gathering |
| `answer` | Response to a question | Q&A flow |
| `finding` | Share a discovery or insight | Knowledge sharing |
| `decision` | Announce a decision | Coordination |
| `critique` | Provide feedback on work | Quality assurance |
| `handoff` | Transfer responsibility | Task transitions |
| `broadcast` | General announcement | Team-wide updates |

## Usage

### Initialize the Bus

```typescript
import { AgentCommunicationBus } from '@framers/agentos';

const bus = new AgentCommunicationBus({
  logger,
  routingConfig: {
    enableRoleRouting: true,
    enableLoadBalancing: true,
    defaultTtlMs: 60000,
    maxRetries: 3,
  },
});
```

### Register Agents

```typescript
// Register agents with their agency and role
bus.registerAgent('analyst-gmi-1', 'agency-123', 'analyst');
bus.registerAgent('researcher-gmi-1', 'agency-123', 'researcher');
bus.registerAgent('coordinator-gmi-1', 'agency-123', 'coordinator');
```

### Subscribe to Messages

```typescript
// Agent subscribes to receive messages
const unsubscribe = bus.subscribe('analyst-gmi-1', async (message) => {
  console.log(`Received ${message.type} from ${message.fromAgentId}`);
  
  if (message.type === 'task_delegation') {
    // Process the delegated task
    const result = await processTask(message.content);
    
    // Send response
    await bus.sendToAgent(message.fromAgentId, {
      type: 'answer',
      fromAgentId: 'analyst-gmi-1',
      content: result,
      inReplyTo: message.messageId,
      priority: 'normal',
    });
  }
}, {
  messageTypes: ['task_delegation', 'question'],
  minPriority: 'normal',
});

// Later: unsubscribe()
```

### Point-to-Point Messaging

```typescript
// Send to specific agent
await bus.sendToAgent('researcher-gmi-1', {
  type: 'question',
  fromAgentId: 'coordinator-gmi-1',
  content: 'What findings do you have on topic X?',
  priority: 'high',
});

// Send by role (load-balanced if multiple agents)
await bus.sendToRole('agency-123', 'analyst', {
  type: 'task_delegation',
  fromAgentId: 'coordinator-gmi-1',
  content: { data: [...], instructions: 'Analyze trends' },
  priority: 'high',
});
```

### Broadcast

```typescript
// Broadcast to all agents in agency
await bus.broadcast('agency-123', {
  type: 'broadcast',
  fromAgentId: 'coordinator-gmi-1',
  content: 'New priority: Focus on Q4 data',
  priority: 'high',
});

// Broadcast to specific roles
await bus.broadcastToRoles('agency-123', ['analyst', 'researcher'], {
  type: 'status_update',
  fromAgentId: 'coordinator-gmi-1',
  content: 'Phase 1 complete, moving to Phase 2',
  priority: 'normal',
});
```

### Request-Response Pattern

```typescript
// Send request and wait for response
const response = await bus.requestResponse('expert-gmi-1', {
  type: 'question',
  fromAgentId: 'coordinator-gmi-1',
  content: 'What is the optimal approach for this problem?',
  priority: 'high',
  timeoutMs: 30000,
});

if (response.status === 'success') {
  console.log('Answer:', response.content);
} else if (response.status === 'timeout') {
  console.log('Request timed out');
}
```

### Task Handoff

```typescript
// Structured handoff between agents
const result = await bus.handoff('analyst-gmi-1', 'reviewer-gmi-1', {
  taskId: 'analysis-task-1',
  taskDescription: 'Data analysis for Q4 report',
  progress: 0.8,
  completedWork: ['Data collection', 'Initial analysis'],
  remainingWork: ['Final review', 'Report generation'],
  context: { findings: [...], metrics: {...} },
  reason: 'completion',
  instructions: 'Please review and finalize',
});

if (result.accepted) {
  console.log(`Handoff accepted by ${result.newOwnerId}`);
} else {
  console.log(`Handoff rejected: ${result.rejectionReason}`);
}
```

### Topic-Based Pub/Sub

```typescript
// Create a topic
const topic = await bus.createTopic({
  name: 'findings',
  description: 'Research findings channel',
  agencyId: 'agency-123',
  publisherRoles: ['researcher', 'analyst'],
  subscriberRoles: ['coordinator', 'reviewer'],
});

// Subscribe to topic
bus.subscribeToTopic('coordinator-gmi-1', topic.topicId, (message) => {
  console.log('New finding:', message.content);
});

// Publish to topic
await bus.publishToTopic(topic.topicId, {
  type: 'finding',
  fromAgentId: 'researcher-gmi-1',
  content: { discovery: '...', confidence: 0.9 },
  priority: 'high',
});
```

## Message History & Statistics

```typescript
// Get message history
const history = await bus.getMessageHistory('analyst-gmi-1', {
  limit: 50,
  since: new Date(Date.now() - 3600000), // Last hour
  types: ['task_delegation', 'answer'],
  direction: 'received',
});

// Get bus statistics
const stats = bus.getStatistics();
console.log(`Messages sent: ${stats.totalMessagesSent}`);
console.log(`Messages delivered: ${stats.totalMessagesDelivered}`);
console.log(`Avg delivery time: ${stats.avgDeliveryTimeMs}ms`);
```

## Integration with Agency Memory

The Communication Bus integrates with AgencyMemoryManager for automatic context sharing:

```typescript
import { AgencyMemoryManager, AgentCommunicationBus } from '@framers/agentos';

// Auto-ingest important communications to shared memory
bus.subscribe('coordinator-gmi-1', async (message) => {
  if (message.type === 'decision' || message.type === 'finding') {
    await agencyMemoryManager.broadcastToAgency(agencyId, {
      content: JSON.stringify(message.content),
      senderGmiId: message.fromAgentId,
      senderRoleId: message.fromRoleId!,
      broadcastType: message.type === 'decision' ? 'decision' : 'finding',
      priority: message.priority === 'urgent' ? 'critical' : 'normal',
    });
  }
});
```

## Key Interfaces

### AgentMessage

```typescript
interface AgentMessage {
  messageId: string;
  type: AgentMessageType;
  fromAgentId: string;
  fromRoleId?: string;
  toAgentId?: string;
  toRoleId?: string;
  agencyId?: string;
  content: string | Record<string, unknown>;
  priority: MessagePriority;
  sentAt: Date;
  inReplyTo?: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
}
```

### HandoffContext

```typescript
interface HandoffContext {
  taskId: string;
  taskDescription: string;
  progress: number;
  completedWork: string[];
  remainingWork: string[];
  context: Record<string, unknown>;
  reason: 'completion' | 'escalation' | 'specialization' | 'capacity' | 'timeout';
  instructions?: string;
  deadline?: Date;
}
```

See `IAgentCommunicationBus.ts` for complete type definitions.



