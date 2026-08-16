import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Test runner config kept separate from vite.config.ts so the dev/build
// pipeline stays untouched. Reuses the same React plugin the app builds with.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    css: false,
    // Headroom over the 3s asyncUtilTimeout in src/tests/setup.ts: two sequential
    // findBy* misses must still fail on the query, which prints the DOM, rather
    // than on a bare test-level timeout that prints nothing useful.
    testTimeout: 10_000,
  },
})
