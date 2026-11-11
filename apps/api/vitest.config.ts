import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests boot a real (embedded) Postgres once per file.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
