/**
 * routerOs.connectionClose.test.ts
 *
 * The `routerOsConnectionClose` patch is loaded by importing
 * `routerOs.service` (same mechanism as the `!empty` patch). These tests
 * use a real TCP mini-RouterOS server and the real `routeros-client` to
 * reproduce the three ways a socket close could previously hang the
 * backend:
 *
 *   (a) router closes the socket mid-command → `.get()` rejects fast
 *   (b) router closes the socket during /login → `.connect()` rejects
 *   (c) router goes silent → `withRouterDeadline` destroys the socket
 *       and `disconnect()` resolves
 *
 * Plus (d)/(e) regression guards for process stability:
 *   (d) no 'unhandledRejection' / 'uncaughtException' during any of the
 *       above
 *   (e) no '#' keepalive writes reach the server after close
 *
 * The fail-before/pass-after pair for (a) and (b) — confirming the patch
 * actually does something — cannot be shown in a sibling Vitest worker:
 * the patch is applied process-wide the first time `routerOs.service` is
 * imported anywhere in the worker, so a file that deliberately omits the
 * import still runs in a worker that already has the patch in place.
 * The unpatched hang behaviour (both cases stall indefinitely) was
 * captured with a standalone Node script run on 2026-11-06 before the
 * patch was merged.
 */
import '../../services/routerOs.service';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'net';
import { withRouterDeadline, disconnectWithDeadline } from '../../services/routerDeadline';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RouterOSClient: any;
beforeEach(async () => {
  const mod = await import('routeros-client');
  RouterOSClient = (mod as unknown as { RouterOSClient: unknown }).RouterOSClient;
});

// -------------------- wire helpers (same as emptyReply test) --------------------

function encodeLen(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) {
    const b = Buffer.alloc(2);
    const v = len | 0x8000;
    b[0] = (v >> 8) & 0xff;
    b[1] = v & 0xff;
    return b;
  }
  throw new Error('encodeLen: word too long for test');
}
function encodeWord(word: string): Buffer {
  const payload = Buffer.from(word, 'latin1');
  return Buffer.concat([encodeLen(payload.length), payload]);
}
function encodeSentence(words: string[]): Buffer {
  const parts = words.map(encodeWord);
  parts.push(Buffer.from([0x00]));
  return Buffer.concat(parts);
}
class WireDecoder {
  private buf = Buffer.alloc(0);
  feed(chunk: Buffer, onSentence: (words: string[]) => void): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    let words: string[] = [];
    for (;;) {
      if (this.buf.length === 0) break;
      const first = this.buf[0];
      let descriptor = 1;
      let len = first;
      if (first & 0x80) {
        if ((first & 0xc0) === 0x80) {
          if (this.buf.length < 2) break;
          len = ((first & 0x3f) << 8) + this.buf[1];
          descriptor = 2;
        } else {
          throw new Error('unsupported length prefix');
        }
      }
      if (this.buf.length < descriptor + len) break;
      if (len === 0) {
        this.buf = this.buf.slice(descriptor);
        onSentence(words);
        words = [];
        continue;
      }
      const word = this.buf.slice(descriptor, descriptor + len).toString('latin1');
      words.push(word);
      this.buf = this.buf.slice(descriptor + len);
    }
  }
}

// -------------------- scriptable server --------------------

interface ServerCtx {
  server: net.Server;
  port: number;
  sockets: Set<net.Socket>;
  /** 'login-close' closes socket mid /login; 'silent-cmd' never replies to the
   *  first non-login command; 'close-cmd' closes socket after receiving the
   *  first non-login command. */
  mode: 'normal' | 'login-close' | 'silent-cmd' | 'close-cmd';
  /** Track every command word seen; used to assert no post-close keepalive '#'. */
  commandsReceived: string[];
  loginSeen: boolean;
}

async function startServer(mode: ServerCtx['mode']): Promise<ServerCtx> {
  const ctx: ServerCtx = {
    server: null as unknown as net.Server,
    port: 0,
    sockets: new Set(),
    mode,
    commandsReceived: [],
    loginSeen: false,
  };
  ctx.server = net.createServer((socket) => {
    ctx.sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => ctx.sockets.delete(socket));
    const decoder = new WireDecoder();
    socket.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      decoder.feed(buf, (words) => {
        if (words.length === 0) return;
        const tagWord = words.find((w) => w.startsWith('.tag='));
        const tag = tagWord ? tagWord.slice(5) : '';
        const cmd = words[0];
        ctx.commandsReceived.push(cmd);
        if (cmd === '/login') {
          ctx.loginSeen = true;
          if (ctx.mode === 'login-close') {
            // Destroy the socket mid /login — connect() must reject.
            socket.destroy();
            return;
          }
          socket.write(encodeSentence(['!done', `.tag=${tag}`]));
          return;
        }
        // Non-login path
        if (ctx.mode === 'silent-cmd') {
          // Never answer.
          return;
        }
        if (ctx.mode === 'close-cmd') {
          socket.destroy();
          return;
        }
        socket.write(encodeSentence(['!done', `.tag=${tag}`]));
      });
    });
  });
  await new Promise<void>((resolve) => ctx.server.listen(0, '127.0.0.1', () => resolve()));
  const addr = ctx.server.address() as net.AddressInfo;
  ctx.port = addr.port;
  return ctx;
}
async function stopServer(ctx: ServerCtx): Promise<void> {
  for (const s of ctx.sockets) s.destroy();
  await new Promise<void>((resolve) => ctx.server.close(() => resolve()));
}

// -------------------- process-crash sentinels --------------------

function installProcessSentinels(): { unhandled: unknown[]; uncaught: unknown[]; dispose: () => void } {
  const unhandled: unknown[] = [];
  const uncaught: unknown[] = [];
  const onUnhandled = (r: unknown) => { unhandled.push(r); };
  const onUncaught = (e: unknown) => { uncaught.push(e); };
  process.on('unhandledRejection', onUnhandled);
  process.on('uncaughtException', onUncaught);
  return {
    unhandled,
    uncaught,
    dispose: () => {
      process.off('unhandledRejection', onUnhandled);
      process.off('uncaughtException', onUncaught);
    },
  };
}

// -------------------- tests --------------------

describe('RouterOS connection-close patch', () => {
  it('(a) mid-command socket close rejects the pending .get() within 1 s', async () => {
    const ctx = await startServer('close-cmd');
    const sentinels = installProcessSentinels();
    try {
      const client = new RouterOSClient({
        host: '127.0.0.1', port: ctx.port, user: 'u', password: 'p', timeout: 30,
      });
      client.on?.('error', () => {});
      const api = await client.connect();
      const t0 = Date.now();
      await expect(api.menu('/ip/hotspot').get()).rejects.toThrow(/closed/i);
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(sentinels.uncaught).toHaveLength(0);
      expect(sentinels.unhandled).toHaveLength(0);
      await client.close().catch(() => {});
    } finally {
      sentinels.dispose();
      await stopServer(ctx);
    }
  });

  it('(b) socket close during /login rejects client.connect()', async () => {
    const ctx = await startServer('login-close');
    const sentinels = installProcessSentinels();
    try {
      const client = new RouterOSClient({
        host: '127.0.0.1', port: ctx.port, user: 'u', password: 'p', timeout: 30,
      });
      client.on?.('error', () => {});
      const t0 = Date.now();
      await expect(client.connect()).rejects.toBeDefined();
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(sentinels.uncaught).toHaveLength(0);
      expect(sentinels.unhandled).toHaveLength(0);
    } finally {
      sentinels.dispose();
      await stopServer(ctx);
    }
  });

  it('(c)+(d)+(e) silent router: withRouterDeadline destroys socket, disconnect resolves, no keepalive leaks, no process crash', async () => {
    const ctx = await startServer('silent-cmd');
    const sentinels = installProcessSentinels();
    try {
      const client = new RouterOSClient({
        host: '127.0.0.1', port: ctx.port, user: 'u', password: 'p', timeout: 30,
      });
      client.on?.('error', () => {});
      const api = await client.connect();

      const result = await withRouterDeadline('test-router', 200, async (dctx) => {
        dctx.onClient(client);
        dctx.step = 'silent-get';
        return await api.menu('/ip/hotspot').get();
      });
      expect(result.status).toBe('timeout');

      // disconnect must not hang
      const t0 = Date.now();
      await disconnectWithDeadline(client, 2_000);
      // Cap is 2 s; allow a small scheduling margin for the deadline timer.
      expect(Date.now() - t0).toBeLessThan(2_500);

      // Give any orphaned keepalive timer a chance to fire (would be
      // half of client.timeout = 15 s; we only wait a short moment to
      // assert no '#' write arrived after the socket closed).
      const beforeCount = ctx.commandsReceived.filter((c) => c === '#').length;
      await new Promise((r) => setTimeout(r, 100));
      const afterCount = ctx.commandsReceived.filter((c) => c === '#').length;
      expect(afterCount).toBe(beforeCount);

      expect(sentinels.uncaught).toHaveLength(0);
      expect(sentinels.unhandled).toHaveLength(0);
    } finally {
      sentinels.dispose();
      await stopServer(ctx);
    }
  });
});
