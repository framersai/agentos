# Examples — Practical Cookbook

> Complete, runnable code snippets for common AgentOS patterns.

---

## Table of Contents

1. [Customer Service Agency](#1-customer-service-agency)
2. [Research Team](#2-research-team)
3. [Content Pipeline](#3-content-pipeline)
4. [Voice Call Center](#4-voice-call-center)
5. [Code Review Bot](#5-code-review-bot)
6. [Knowledge Base Q&A](#6-knowledge-base-qa)
7. [Multi-Channel Support Bot](#7-multi-channel-support-bot)
8. [Automated Blog Publisher](#8-automated-blog-publisher)
9. [Runtime-Configured Tools](#9-runtime-configured-tools)
10. [Agency Streaming](#10-agency-streaming)
11. [Query Router](#11-query-router)
12. [Query Router Host Hooks](#12-query-router-host-hooks)

---

## 1. Customer Service Agency

Sequential pipeline with human-in-the-loop escalation.

```typescript
import { agency } from '@framers/agentos';

const supportTeam = agency({
  provider: 'openai',
  model: 'gpt-4o',
  strategy: 'sequential',
  agents: {
    triage: {
      instructions: `
        You are a support triage agent. Classify the issue as:
        - "simple": can be resolved with documentation
        - "billing": requires billing team
        - "technical": requires engineering team
        - "escalate": critical issue requiring human
        Reply with only the classification label.
      `,
    },
    resolver: {
      instructions: `
        You are a support resolver. Based on the classification, provide:
        - A clear, empathetic response to the customer
        - Step-by-step resolution if applicable
        - If classified as "escalate", ask the human team to take over
      `,
      hitl: {
        conditions: [{ type: 'agent_flag', flag: 'needs_escalation' }],
        prompt: 'A customer issue requires human review. Approve the response or redirect.',
      },
    },
  },
  guardrails: ['content-safety', 'pii-filter'],
});

const result = await supportTeam.generate(
  'My account was charged twice for the same subscription and I am very upset.'
);

console.log(result.text);
```

---

## 2. Research Team

Parallel information gathering with RAG and synthesis.

```typescript
import { agency } from '@framers/agentos';

const researchTeam = agency({
  provider: 'anthropic',
  strategy: 'parallel',
  agents: {
    webResearcher: {
      instructions:
        'Search the web for current information on the topic. Return key facts and sources.',
      tools: ['web_search', 'web_fetch'],
    },
    academicResearcher: {
      instructions: 'Search arXiv and Google Scholar for academic papers. Summarize findings.',
      tools: ['arxiv_search'],
    },
    newsAnalyst: {
      instructions:
        'Find recent news and trends on the topic. Highlight what changed in the last month.',
      tools: ['news_search'],
    },
  },
  synthesizer: {
    instructions: `
      You receive research from three specialists. Synthesize their findings into:
      1. A 3-paragraph executive summary
      2. Key facts (bullet points, with sources)
      3. Open questions and limitations
    `,
  },
  memory: {
    enabled: true,
    type: 'semantic',
    scope: 'session',
  },
});

const report = await researchTeam.generate(
  'Impact of quantum error correction on near-term quantum computing.'
);
console.log(report.text);
```

---

## 3. Content Pipeline

Review loop with social posting on approval.

```typescript
import { workflow } from '@framers/agentos/orchestration';
import { SocialPostManager, ContentAdaptationEngine } from '@framers/agentos/social-posting';
import { z } from 'zod';

const contentPipeline = workflow('content-pipeline')
  .input(z.object({ topic: z.string(), audience: z.string() }))
  .returns(z.object({ publishedTo: z.array(z.string()) }))

  // Step 1: Research the topic
  .step('research', {
    tool: 'web_search',
    effectClass: 'external',
  })

  // Step 2: Draft the blog post
  .step('draft', {
    gmi: {
      instructions: `
        Write a 400-word blog post on {{topic}} for {{audience}}.
        Include 3 key insights and a call to action.
      `,
    },
  })

  // Step 3: Human approval
  .step('review', {
    human: { prompt: 'Review the draft. Approve or request changes.' },
  })

  // Step 4: Generate a social post variant
  .step('social-draft', {
    gmi: {
      instructions: 'Create a Twitter/LinkedIn-optimized 280-char teaser for the blog post.',
    },
  })

  // Step 5: Publish to social platforms
  .step('publish', {
    tool: 'multi_channel_post',
    effectClass: 'external',
  })

  .compile();

const result = await contentPipeline.invoke({
  topic: 'How AI agents will change software development in 2026',
  audience: 'senior software engineers',
});

console.log('Published to:', result.publishedTo);
```

---

## 4. Voice Call Center

Hierarchical agency with voice transport and telephony.

```typescript
import { agency } from '@framers/agentos';

const callCenter = agency({
  provider: 'openai',
  strategy: 'hierarchical',
  voice: {
    sttProvider: 'deepgram',
    ttsProvider: 'elevenlabs',
    voiceId: 'professional-en-us',
  },
  agents: {
    receptionist: {
      instructions: `
        You are a friendly receptionist. Greet callers, collect their name
        and reason for calling, then route to the appropriate specialist.
        Route to "billing" for payment issues, "technical" for product problems,
        or "sales" for new customer inquiries.
      `,
      role: 'orchestrator',
    },
    billing: {
      instructions: 'You are a billing specialist. Resolve payment issues calmly and efficiently.',
      role: 'worker',
    },
    technical: {
      instructions: 'You are a technical support specialist. Diagnose and resolve product issues.',
      role: 'worker',
      tools: ['knowledge_base_search', 'ticket_create'],
    },
    sales: {
      instructions: 'You are a sales consultant. Help prospects find the right plan.',
      role: 'worker',
      tools: ['product_catalog', 'crm_create_lead'],
    },
  },
  telephony: {
    provider: 'twilio',
    inboundNumber: process.env.TWILIO_PHONE_NUMBER,
  },
});

// Answer an inbound call
callCenter.listen({
  transport: 'twilio',
  onCallEnd: (summary) => console.log('Call summary:', summary),
});

console.log('Call center ready. Listening for calls...');
```

---

## 5. Code Review Bot

Debate strategy where two agents argue before a final decision.

```typescript
import { agency } from '@framers/agentos';
import { readFileSync } from 'fs';

const codeReviewer = agency({
  provider: 'anthropic',
  strategy: 'debate',
  rounds: 2,
  agents: {
    critic: {
      instructions: `
        You are a strict code reviewer. Find bugs, security issues, performance problems,
        and violations of best practices. Be thorough — your job is to find everything wrong.
      `,
    },
    advocate: {
      instructions: `
        You are a code quality advocate. Identify the strengths of the code:
        good patterns, clear naming, testability, and solid architecture choices.
        Push back on overly pedantic criticism.
      `,
    },
  },
  judge: {
    instructions: `
      You are a senior engineer making the final call on a code review.
      Weigh the critic and advocate's arguments. Output:
      - APPROVE: if the code is production-ready
      - REQUEST_CHANGES: if fixes are needed (list them)
      - REJECT: if the approach is fundamentally flawed
    `,
  },
});

const code = readFileSync('./src/auth.ts', 'utf8');

const review = await codeReviewer.generate(`
  Review this TypeScript code for a production auth module:
  \`\`\`typescript
  ${code}
  \`\`\`
`);

console.log(review.text);
// APPROVE / REQUEST_CHANGES / REJECT + detailed feedback
```

---

## 6. Knowledge Base Q&A

RAG-powered Q&A with cognitive memory for returning users.

```typescript
import { agent } from '@framers/agentos';
import { CognitiveMemoryManager } from '@framers/agentos/memory';

const memory = new CognitiveMemoryManager({
  decay: { enabled: true },
  workingMemory: { capacity: 7 },
  vectorStore: { type: 'hnsw', dimensions: 1536 },
});

const kbAgent = agent({
  provider: 'openai',
  instructions: `
    You are a helpful documentation assistant.
    Search the knowledge base to answer questions accurately.
    If you don't find a relevant answer, say so clearly.
  `,
  tools: ['knowledge_base_search'],
  rag: {
    enabled: true,
    vectorStore: 'hnsw',
    collections: ['product-docs', 'api-reference', 'tutorials'],
    topK: 5,
    minSimilarity: 0.7,
  },
  memory: memory,
});

const session = kbAgent.session('user-alice');

// User returns — memory provides context from previous sessions
const { text: answer } = await session.send(
  'How do I configure rate limiting in the AgentOS middleware?'
);

console.log(answer);
// "Based on the docs, you can configure rate limiting via the `rateLimiting`
//  option in your AgentOSConfig..."

// Follow-up benefits from both RAG and memory
const { text: followUp } = await session.send('What about for the voice pipeline specifically?');

console.log(followUp);
```

---

## 7. Multi-Channel Support Bot

Agency connected to Discord + Slack + Telegram simultaneously.

```typescript
import { agency } from '@framers/agentos';
import { ChannelRouter } from '@framers/agentos/channels';
import { DiscordAdapter } from '@framers/agentos-extensions/channels/discord';
import { SlackAdapter } from '@framers/agentos-extensions/channels/slack';
import { TelegramAdapter } from '@framers/agentos-extensions/channels/telegram';

// 1. Create the agency
const supportBot = agency({
  provider: 'openai',
  strategy: 'sequential',
  agents: {
    greeter: {
      instructions: 'Greet the user and understand their issue in 1–2 sentences.',
    },
    resolver: {
      instructions: 'Provide a clear, helpful resolution. Use the knowledge base if needed.',
      tools: ['knowledge_base_search', 'ticket_create'],
    },
  },
  guardrails: ['content-safety'],
});

// 2. Connect to channels
const router = new ChannelRouter();

const discord = new DiscordAdapter();
const slack = new SlackAdapter();
const telegram = new TelegramAdapter();

await discord.initialize({ credential: process.env.DISCORD_BOT_TOKEN! });
await slack.initialize({ credential: process.env.SLACK_BOT_TOKEN! });
await telegram.initialize({ credential: process.env.TELEGRAM_BOT_TOKEN! });

router.register(discord);
router.register(slack);
router.register(telegram);

// 3. Handle messages from any platform
router.onMessage(async (message, platform) => {
  // Each user gets their own conversation session
  const sessionId = `${platform}:${message.senderId}`;

  const response = await supportBot.generate(message.text, {
    sessionId,
    context: { platform, userId: message.senderId },
  });

  await router.send(platform, message.conversationId, {
    blocks: [{ type: 'text', text: response.text }],
  });
});

console.log('Support bot listening on Discord, Slack, and Telegram...');
```

---

## 8. Automated Blog Publisher

Full pipeline: research → write → image → social posting.

```typescript
import { workflow } from '@framers/agentos/orchestration';
import { generateImage } from '@framers/agentos';
import { SocialPostManager, ContentAdaptationEngine } from '@framers/agentos/social-posting';
import { z } from 'zod';

const blogPublisher = workflow('automated-blog-publisher')
  .input(
    z.object({
      topic: z.string(),
      audience: z.string(),
      platforms: z.array(z.string()).default(['twitter', 'linkedin', 'bluesky']),
    })
  )
  .returns(
    z.object({
      postUrl: z.string(),
      socialUrls: z.record(z.string()),
    })
  )

  // Research
  .step('research', {
    tool: 'web_search',
    effectClass: 'external',
  })

  // Write the post
  .step('write', {
    gmi: {
      instructions: `
        Write a 600-word blog post about {{topic}} for {{audience}}.
        Include: compelling headline, 3 sections with headers, key takeaways.
        Format as Markdown.
      `,
    },
  })

  // Generate a header image
  .step('generate-image', {
    gmi: {
      instructions: 'Describe a header image for this blog post in one sentence.',
    },
  })

  // Parallel: publish to CMS + generate social variants
  .parallel(
    { reducers: {} },
    (wf) =>
      wf.step('publish-cms', {
        tool: 'cms_publish',
        effectClass: 'external',
      }),
    (wf) =>
      wf.step('social-variants', {
        gmi: {
          instructions: `
          Create platform-specific social media posts for this blog post.
          Twitter: 280 chars max, hook + link
          LinkedIn: professional tone, 3 bullet highlights
          Bluesky: casual tone, 300 chars max
          Return as JSON: { twitter, linkedin, bluesky }
        `,
        },
      })
  )

  // Schedule social posts
  .step('schedule-social', {
    tool: 'bulk_scheduler',
    effectClass: 'external',
  })

  .compile();

// Run the pipeline
async function publishPost(topic: string) {
  // First, generate the header image outside the workflow
  const image = await generateImage({
    provider: 'stability',
    model: 'stable-image-core',
    prompt: `A professional blog header image representing: ${topic}. Clean, modern style.`,
    width: 1200,
    height: 628,
    providerOptions: {
      stability: { stylePreset: 'digital-art' },
    },
  });

  const result = await blogPublisher.invoke({
    topic,
    audience: 'software developers',
    platforms: ['twitter', 'linkedin', 'bluesky'],
    // Pass image URL into the workflow context
    headerImageUrl: image.images[0].url,
  });

  console.log('Published:', result.postUrl);
  console.log('Social posts scheduled:', result.socialUrls);
}

await publishPost('How vector databases enable semantic search in AI applications');
```

---

## 9. Runtime-Configured Tools

Direct `AgentOS` initialization with runtime-configured tools via
`createTestAgentOSConfig({ tools })`.

Runnable source: `packages/agentos/examples/agentos-config-tools.mjs`

```typescript
import { AgentOS } from '@framers/agentos';
import { createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

const agent = new AgentOS();

await agent.initialize(
  await createTestAgentOSConfig({
    tools: {
      open_profile: {
        description: 'Load a saved profile record by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'string' },
          },
          required: ['profileId'],
        },
        execute: async ({ profileId }) => ({
          success: true,
          output: {
            profile: {
              id: profileId,
              preferredTheme: 'solarized',
            },
          },
        }),
      },
    },
  })
);

const tool = await agent.getToolOrchestrator().getTool('open_profile');
const result = await tool?.execute({ profileId: 'profile-1' }, {});

console.log(result);
await agent.shutdown();
```

Use this path when the tool should be globally prompt-visible and executable on
direct `processRequest()` turns. Use `externalTools` or the registered-tool
helpers only when the host should stay responsible for execution after a tool
pause.

---

## 10. Agency Streaming

Raw live chunks, finalized approved output, and structured final events from a
single `agency().stream()` run.

```typescript
import { agency, type AgencyStreamResult } from '@framers/agentos';

const streamingTeam = agency({
  provider: 'openai',
  strategy: 'sequential',
  agents: {
    researcher: { instructions: 'Collect the key facts and risks.' },
    writer: { instructions: 'Turn the facts into four crisp bullet points.' },
  },
  hitl: {
    approvals: { beforeReturn: true },
    handler: async () => ({
      approved: true,
      modifications: {
        output: 'Approved for delivery:\\n- Risk 1\\n- Risk 2\\n- Risk 3\\n- Risk 4',
      },
    }),
  },
});

const stream: AgencyStreamResult = streamingTeam.stream(
  'Summarize the main HTTP/3 rollout risks.'
);

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk); // raw live output
}
process.stdout.write('\\n');

for await (const event of stream.fullStream) {
  if (event.type === 'final-output') {
    console.log('Finalized answer:', event.text);
    console.log('Agent calls:', event.agentCalls.length);
  }
}

for await (const approved of stream.finalTextStream) {
  console.log('Approved-only stream:', approved);
}

console.log(await stream.text);
console.log(await stream.agentCalls);
```

Runnable source: `packages/agentos/examples/agency-streaming.mjs`

---

## 11. Query Router

Tier classification, retrieval routing, and fallback metadata from the
standalone `QueryRouter`.

```typescript
import { QueryRouter } from '@framers/agentos';

const router = new QueryRouter({
  knowledgeCorpus: ['./docs', './packages/agentos/docs'],
  availableTools: ['web_search', 'deep_research'],
  onClassification: (result) => {
    console.log(result.tier, result.confidence);
  },
});

await router.init();

const result = await router.route(
  'How does AgentOS memory retrieval work, and when does it fall back to keyword search?'
);

console.log(result.answer);
console.log(result.classification.tier);
console.log(result.tiersUsed);
console.log(result.fallbacksUsed);
console.log(result.sources);

await router.close();
```

Runnable source: `packages/agentos/examples/query-router.mjs`

---

## 12. Query Router Host Hooks

Host-provided graph expansion, reranking, and deep research hooks layered onto
the same `QueryRouter` interface.

```typescript
import { QueryRouter } from '@framers/agentos';

const router = new QueryRouter({
  knowledgeCorpus: ['./docs', './packages/agentos/docs'],
  graphEnabled: true,
  deepResearchEnabled: true,
  graphExpand: async (seedChunks) => [...seedChunks, extraGraphChunk],
  rerank: async (_query, chunks, topN) => chunks.slice(0, topN),
  deepResearch: async (query, sources) => ({
    synthesis: `Host-provided research for ${query}`,
    sources: externalResearchChunks,
  }),
});

await router.init();
console.log(router.getCorpusStats()); // runtime modes become active
```

Runnable source: `packages/agentos/examples/query-router-host-hooks.mjs`

---

## Related Guides

- [GETTING_STARTED.md](./GETTING_STARTED.md) — installation and first steps
- [ORCHESTRATION.md](./ORCHESTRATION.md) — graphs, workflows, missions
- [CHANNELS.md](./CHANNELS.md) — channel setup
- [SOCIAL_POSTING.md](./SOCIAL_POSTING.md) — social media publishing
- [HIGH_LEVEL_API.md](./HIGH_LEVEL_API.md) — `AgentOS`, helper wrappers, and runtime tool registration
- [COGNITIVE_MEMORY_GUIDE.md](./COGNITIVE_MEMORY_GUIDE.md) — memory system
- [IMAGE_GENERATION.md](./IMAGE_GENERATION.md) — image provider setup
- [EVALUATION.md](./EVALUATION.md) — testing and benchmarking
- [AGENCY_API.md](./AGENCY_API.md) — full agency reference
