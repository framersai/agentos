import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, 'src');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@agentos\/core\/(.*)$/, replacement: `${srcDir}/$1` },
      { find: '@framers/agentos', replacement: srcDir },
      { find: '@prisma/client', replacement: path.resolve(__dirname, 'src/stubs/prismaClient.ts') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'src/**/*.spec.ts'],
    coverage: {
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      all: true,
      exclude: [
        'src/stubs/**',
        'src/server/**',
        'src/services/user_auth/**',
        'src/extensions/builtin/**',
        'src/core/memory_lifecycle/**',
        'src/core/language/**',
        'src/core/storage/**',
        'src/core/ai_utilities/**',
        'src/core/llm/routing/**',
        'src/core/llm/streaming/**',
        'src/core/llm/providers/implementations/**',
        'src/core/llm/providers/AIModelProviderManager.ts',
        'src/core/llm/providers/errors/**',
        'src/core/agents/**',
        'src/core/tools/**',
        'src/core/conversation/**',
        'src/core/usage/**',
        'src/core/workflows/storage/**',
        'src/core/workflows/runtime/**',
        'src/core/evaluation/LLMJudge.ts',
        'src/core/sandbox/**',
        'src/core/cognitive_substrate/**',
        'src/extensions/RegistryLoader.ts',
        'src/extensions/RegistryConfig.ts',
        'src/rag/implementations/**',
        'src/rag/RetrievalAugmentor.ts',
        'src/rag/EmbeddingManager.ts',
        'src/config/AgentOSConfig.ts',
        'src/utils/uuid.ts',
        'src/api/AgentOS.ts',
        'src/types/**',
        '**/*.d.ts',
        '**/index.ts',
        'scripts/**',
        'drizzle.config.js',
        'node_modules/**',
      ],
      thresholds: {
        statements: 65,
        branches: 65,
        functions: 70,
        lines: 65,
      },
    },
  },
});
