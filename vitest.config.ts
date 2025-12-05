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
        'src/rag/implementations/**',
        'src/types/**',
        '**/*.d.ts',
        '**/index.ts',
        'scripts/**',
        'drizzle.config.js',
        'node_modules/**',
      ],
      thresholds: {
        statements: 45,
        branches: 55,
        functions: 40,
        lines: 45,
      },
    },
  },
});
