import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'apps/worker/src/**/*.test.ts'],
    environment: 'node',
  },
});
