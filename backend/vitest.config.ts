import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/tests/setup.ts'],
    testTimeout: 10000,
    // Only run TypeScript sources — never compiled copies in dist/ (stale
    // `npm run build` output fails: compiled CommonJS cannot require() vitest).
    include: ['src/**/*.test.ts'],
  },
});
