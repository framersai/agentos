import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, 'src');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@agentos\/core\/(.*)$/, replacement: `${srcDir}/$1` },
      { find: '@agentos/core', replacement: srcDir },
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
    },
  },
});
