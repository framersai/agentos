#!/usr/bin/env node

import { AgentCommunicationBus } from '../dist/index.js';

const bus = new AgentCommunicationBus({
  routingConfig: {
    enableRoleRouting: true,
    enableLoadBalancing: true,
  },
});

bus.registerAgent('coordinator-gmi', 'agency-docs', 'coordinator');
bus.registerAgent('researcher-gmi', 'agency-docs', 'researcher');
bus.registerAgent('writer-gmi', 'agency-docs', 'writer');

bus.subscribe(
  'researcher-gmi',
  async (message) => {
    if (message.type === 'task_delegation') {
      console.log('Researcher received delegated task:', message.content);
      return;
    }

    if (message.type === 'question') {
      await bus.sendToAgent(message.fromAgentId, {
        type: 'answer',
        fromAgentId: 'researcher-gmi',
        content: {
          findings: [
            'The graph runtime should stay shared across all three authoring APIs.',
            'Checkpointing needs to be first-class, not bolted onto the planner.',
            'Examples should show workflow(), AgentGraph, and mission() side by side.',
          ],
        },
        inReplyTo: message.messageId,
        priority: 'normal',
      });
    }
  },
  { messageTypes: ['question', 'task_delegation'] },
);

bus.subscribe(
  'writer-gmi',
  async (message) => {
    if (message.type === 'task_delegation') {
      await bus.sendToAgent(message.fromAgentId, {
        type: 'answer',
        fromAgentId: 'writer-gmi',
        content: {
          accepted: true,
          note: 'I can turn the research notes into a concise release note.',
        },
        inReplyTo: message.messageId,
        priority: 'normal',
      });
    }
  },
  { messageTypes: ['task_delegation'] },
);

async function main() {
  console.log('=== AgentCommunicationBus ===');

  const roleDelivery = await bus.sendToRole('agency-docs', 'researcher', {
    type: 'task_delegation',
    fromAgentId: 'coordinator-gmi',
    content: {
      task: 'Review the orchestration rollout',
      output: 'top risks',
    },
    priority: 'high',
  });
  console.log('Role-routed delivery:', roleDelivery.status);

  const response = await bus.requestResponse('researcher-gmi', {
    type: 'question',
    fromAgentId: 'coordinator-gmi',
    content: 'What are the top three rollout risks?',
    priority: 'high',
    timeoutMs: 5_000,
  });
  console.log('\nResearch answer:');
  console.dir(response, { depth: null });

  const handoff = await bus.handoff('researcher-gmi', 'writer-gmi', {
    taskId: 'rollout-note',
    taskDescription: 'Convert the findings into release-note prose',
    progress: 0.8,
    completedWork: ['Collected risks', 'Ranked findings'],
    remainingWork: ['Write final release note'],
    context: { audience: 'engineering' },
    reason: 'completion',
    instructions: 'Write concise internal release notes.',
  });
  console.log('\nHandoff result:');
  console.dir(handoff, { depth: null });

  const coordinatorHistory = await bus.getMessageHistory('coordinator-gmi', {
    limit: 5,
    direction: 'both',
  });
  console.log('\nRecent coordinator messages:');
  console.table(
    coordinatorHistory.map((message) => ({
      type: message.type,
      from: message.fromAgentId,
      to: message.toAgentId ?? '(broadcast)',
      inReplyTo: message.inReplyTo ?? '',
    })),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
