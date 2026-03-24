#!/usr/bin/env node

import { agent, generateImage, generateText, streamText } from '../dist/index.js';

const model = process.env.AGENTOS_MODEL || process.env.OPENAI_MODEL || 'openai:gpt-4.1-mini';

async function main() {
  console.log(`Using model: ${model}`);

  console.log('\n=== generateText() ===');
  const quick = await generateText({
    model,
    prompt: 'Explain what QUIC is in 3 concise bullet points.',
  });
  console.log(quick.text);

  console.log('\n=== streamText() ===');
  const live = streamText({
    model,
    prompt: 'Stream a short explanation of how QUIC differs from TCP.',
  });
  for await (const delta of live.textStream) {
    process.stdout.write(delta);
  }
  process.stdout.write('\n');

  console.log('\n=== generateImage() ===');
  const imageModel = process.env.AGENTOS_IMAGE_MODEL || 'openai:gpt-image-1.5';
  const image = await generateImage({
    model: imageModel,
    prompt: 'A clean technical illustration of packets moving through a network switch.',
  });
  console.log(`provider=${image.provider} images=${image.images.length}`);

  console.log('\n=== agent() ===');
  const assistant = agent({
    model,
    instructions: 'You are a concise networking tutor.',
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
