import { defineConfig } from 'vitest/config';

// The engine is pure (no DOM), so tests run in the Node environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
