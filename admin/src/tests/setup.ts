// The `/vitest` entrypoint registers the jest-dom matchers on Vitest's `expect`
// AND augments Vitest's Assertion types, so matchers like toBeInTheDocument are
// available at runtime and type-check under `tsc -b`.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// Vitest runs the page suites in parallel, so more test files than cores means
// a worker can be descheduled mid-render. The 1s default left `findBy*` racing
// that contention rather than the code under test. Raising only the ceiling
// keeps every assertion intact — an element that never appears still fails.
// Kept under the testTimeout set in vitest.config.ts so a real miss reports the
// DOM dump from testing-library rather than a bare test-level timeout.
configure({ asyncUtilTimeout: 3000 })

// Node 25 exposes an experimental global `localStorage`/`sessionStorage` backed
// by `--localstorage-file`. Under Vitest that flag has no valid path, so the
// global getter throws / returns a non-functional object that shadows jsdom's
// Storage. Install a plain in-memory implementation so app code that reads and
// writes web storage behaves deterministically in tests.
function createMemoryStorage(): Storage {
  let store: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(store).length
    },
    clear() {
      store = {}
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null
    },
    removeItem(key: string) {
      delete store[key]
    },
    setItem(key: string, value: string) {
      store[key] = String(value)
    },
  } as Storage
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, name, {
    value: createMemoryStorage(),
    writable: true,
    configurable: true,
  })
}

// Unmount rendered components and reset storage between tests so state (auth
// tokens, the session-expired flag, mounted toasts) never leaks across cases.
afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})
