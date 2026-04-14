#!/usr/bin/env node

import { agent, generateImage, generateText, streamText } from '../dist/index.js';

// Provider-first style: set provider and let AgentOS pick the best default model.
// Requires the matching env var (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.) to be set.
//
// Legacy format is still supported:
//   const model = process.env.AGENTOS_MODEL || 'openai:gpt-4.1-mini';

const provider = process.env.AGENTOS_PROVIDER || 'openai';

async function main() {
  console.log(`Using provider: ${provider}`);

  console.log('\n=== generateText() — provider-first ===');
  const quick = await generateText({
    provider,
    prompt: 'Explain what QUIC is in 3 concise bullet points.',
  });
  console.log(quick.text);

  console.log('\n=== generateText() — legacy model string (still works) ===');
  const legacy = await generateText({
    model: 'openai:gpt-4o',  // legacy format, still supported
    prompt: 'What is TCP in one sentence?',
  });
  console.log(legacy.text);

  console.log('\n=== streamText() — provider-first ===');
  const live = streamText({
    provider,
    prompt: 'Stream a short explanation of how QUIC differs from TCP.',
  });
  for await (const delta of live.textStream) {
    process.stdout.write(delta);
  }
  process.stdout.write('\n');

  console.log('\n=== generateImage() — provider-first ===');
  const image = await generateImage({
    provider: 'openai',
    prompt: 'A clean technical illustration of packets moving through a network switch.',
  });
  console.log(`provider=${image.provider} images=${image.images.length}`);

  console.log('\n=== agent() — provider-first ===');
  const assistant = agent({
    provider,
    instructions: 'You are a concise networking tutor.',
    memory: {
      types: ['episodic', 'semantic'],
      working: { enabled: true },
    },
    maxSteps: 3,
  });

  const session = assistant.session('high-level-api-demo');
  const first = await session.send('What problem was QUIC designed to solve?');
  console.log(first.text);

  const second = await session.send('Now compare QUIC and TCP in one short paragraph.');
  console.log(second.text);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
