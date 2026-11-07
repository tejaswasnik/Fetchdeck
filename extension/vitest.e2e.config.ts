import { defineConfig } from 'vitest/config';

// The end-to-end test drives a real Chromium, so it is not part of `npm run check`.
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    testTimeout: 90_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
