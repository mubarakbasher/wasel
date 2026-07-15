// Sentry error tracking — captures crashes and unhandled API errors with stack
// traces so post-incident debugging doesn't depend on container logs alone.
//
// No-op unless SENTRY_DSN is set: dev/test boot behaviour is unchanged, and all
// capture calls (captureException/flush) resolve harmlessly when uninitialized.
// This module must be imported before the rest of the app in server.ts.
import * as Sentry from '@sentry/node';
import { config } from './index';

export const sentryEnabled = Boolean(config.SENTRY_DSN) && config.NODE_ENV !== 'test';

if (sentryEnabled) {
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    // Errors only — no performance tracing (keeps the free-tier quota for crashes).
    tracesSampleRate: 0,
    // Never attach request bodies, cookies, or IPs automatically.
    sendDefaultPii: false,
  });
}

export { Sentry };
