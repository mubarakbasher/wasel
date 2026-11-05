/**
 * routerDeadline.ts — a hard-timeout wrapper for RouterOS work.
 *
 * Why its own module
 * ------------------
 * The job tests (`ntpConvergence.test.ts`, `macCookieConvergence.test.ts`)
 * mock `routerOs.service` wholesale. If `withRouterDeadline` lived there,
 * the mock would also replace the deadline wrapper and the tests could not
 * exercise it. It lives in its own file so the jobs can import it
 * separately and the deadline can't be mocked away by accident.
 *
 * Signature
 * ---------
 *   withRouterDeadline(routerId, ms, work(ctx)) → Promise<Result<T>>
 *
 * `ctx` carries:
 *   - `step: string`       — the job updates this as it progresses so the
 *                            timeout log says WHERE we were stuck
 *                            ("connect", "ntp.read", "radius.update", …).
 *   - `signal: AbortSignal` — aborted on expiry. `connectToRouter` reads
 *                            it to stop retrying.
 *   - `onClient(client)`   — register each RouterOS client in use. On
 *                            expiry we destroy their underlying sockets
 *                            so blocking reads/writes resolve/reject.
 *
 * On expiry:
 *   - Abort the signal.
 *   - For every registered client, destroy its raw TCP socket with NO
 *     argument. Passing an Error argument makes `net.Socket#destroy`
 *     synchronously emit `error`; the Connector removed its `error`
 *     listener in some paths (Connector.destroy() calls
 *     removeAllListeners), and server.ts' uncaughtException handler
 *     exits the backend. The no-arg destroy only fires `close`, which
 *     the connection-close patch (routerOsConnectionClose.ts) already
 *     handles safely.
 *   - Return `{ status: 'timeout', step }` and swallow whatever `work`
 *     eventually settles with.
 *
 * On success / thrown error: clear the timer, return
 * `{ status: 'ok', value }` or `{ status: 'error', error }`.
 */
import logger from '../config/logger';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Narrow shape of the pieces of a RouterOS client that we need to destroy. */
export interface DeadlineClient {
  rosApi?: {
    connector?: {
      socket?: { destroy: () => void } | null;
    } | null;
  } | null;
}

export interface RouterDeadlineCtx {
  /** Mutable progress marker — set this to label the current step. */
  step: string;
  /** Aborted on expiry. Callers should bail out when they see .aborted = true. */
  readonly signal: AbortSignal;
  /** Register a client so the deadline can destroy its socket on expiry. */
  onClient: (client: DeadlineClient) => void;
}

export type RouterDeadlineResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'timeout'; step: string }
  | { status: 'error'; error: unknown };

/**
 * Run `work` under a hard `ms` deadline. On expiry, destroy every
 * registered client's socket and return a structured timeout result —
 * never throws.
 */
export async function withRouterDeadline<T>(
  routerId: string,
  ms: number,
  work: (ctx: RouterDeadlineCtx) => Promise<T>,
): Promise<RouterDeadlineResult<T>> {
  const abortController = new AbortController();
  const clients: DeadlineClient[] = [];
  let settled = false;

  const ctx: RouterDeadlineCtx = {
    step: 'start',
    signal: abortController.signal,
    onClient: (client) => {
      if (client) clients.push(client);
    },
  };

  return new Promise<RouterDeadlineResult<T>>((resolve) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const step = ctx.step;
      try {
        abortController.abort();
      } catch {
        // ignore
      }
      destroyClientSockets(clients, routerId, step);
      logger.warn('RouterOS deadline exceeded', { routerId, step, ms });
      resolve({ status: 'timeout', step });
    }, ms);

    // Run the work. Swallow late settlement so there is no unhandled
    // rejection after the deadline wins.
    work(ctx).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status: 'ok', value });
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status: 'error', error });
      },
    );
  });
}

function destroyClientSockets(
  clients: DeadlineClient[],
  routerId: string,
  step: string,
): void {
  for (const client of clients) {
    try {
      // NO ARGUMENT — passing an Error would emit 'error' on a connector
      // whose listeners may already have been removed, which bubbles to
      // process.on('uncaughtException') and exits the backend.
      const socket = (client as any)?.rosApi?.connector?.socket;
      socket?.destroy?.();
    } catch (err) {
      logger.debug('RouterOS deadline: socket destroy failed (ignored)', {
        routerId,
        step,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Best-effort `client.disconnect()` with a hard `ms` cap. Never throws,
 * never hangs. On cap expiry the raw socket is destroyed (no-arg).
 *
 * Use this at the end of every job iteration — RouterOSClient.disconnect()
 * can itself block on a quiet socket, so a bare `await disconnect()` can
 * recreate exactly the hang we are trying to prevent.
 */
export async function disconnectWithDeadline(
  client: DeadlineClient & { disconnect?: () => Promise<unknown> },
  ms = 5_000,
): Promise<void> {
  if (!client) return;

  let settled = false;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        const socket = (client as any)?.rosApi?.connector?.socket;
        socket?.destroy?.();
      } catch {
        // ignore
      }
      resolve();
    }, ms);

    const p = (() => {
      try {
        return client.disconnect?.();
      } catch (err) {
        return Promise.reject(err);
      }
    })();

    Promise.resolve(p).then(
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      },
    );
  });
}
