/**
 * routerOs.emptyReply.test.ts
 *
 * RouterOS 7.18+ answers data-less commands with the reply word `!empty`,
 * followed by `!done`. `node-routeros` 1.6.8 does not know `!empty` and emits
 * an `unknown` event that `onUnknown` turns into a thrown RosException inside
 * the socket data callback — uncatchable by any `.get()` try/catch.
 *
 * These tests spin up a REAL TCP RouterOS mini-server speaking the length-
 * prefixed word protocol and drive REAL `routeros-client` / `node-routeros`
 * through it. No module mocks — mocks are exactly why the bug stayed hidden.
 */
// Load the patch the way production does: through routerOs.service, never by
// importing routerOsEmptyReply here. If that service stops importing it, every
// case below must fail.
import '../../services/routerOs.service';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'net';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RouterOSClient: any;
beforeEach(async () => {
  // Lazy require so other test files' vi.mock('routeros-client', ...) that
  // run earlier in a worker cannot win.
  const mod = await import('routeros-client');
  RouterOSClient = (mod as unknown as { RouterOSClient: unknown }).RouterOSClient;
});

// -------------------- RouterOS wire-format helpers --------------------

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

/** Encode a full sentence terminated by a zero-length word. */
function encodeSentence(words: string[]): Buffer {
  const parts = words.map(encodeWord);
  parts.push(Buffer.from([0x00]));
  return Buffer.concat(parts);
}

/** Minimal decoder — single-byte length only (good enough for test commands). */
class WireDecoder {
  private buf = Buffer.alloc(0);
  feed(chunk: Buffer, onSentence: (words: string[]) => void): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    let words: string[] = [];
    for (;;) {
      if (this.buf.length === 0) break;
      const first = this.buf[0];
      // Multi-byte length (>=0x80) — need at least 2 bytes
      let descriptor = 1;
      let len = first;
      if (first & 0x80) {
        if ((first & 0xc0) === 0x80) {
          if (this.buf.length < 2) break;
          len = ((first & 0x3f) << 8) + this.buf[1];
          descriptor = 2;
        } else {
          throw new Error('WireDecoder: unsupported length prefix');
        }
      }
      if (this.buf.length < descriptor + len) break;
      if (len === 0) {
        // sentence terminator
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

// -------------------- Scriptable mini RouterOS server --------------------

type ReplyScript = (tag: string) => Buffer[];

interface ServerCtx {
  server: net.Server;
  port: number;
  nextCommandReply: ReplyScript | null;
  queue: ReplyScript[];
  sockets: Set<net.Socket>;
}

async function startServer(): Promise<ServerCtx> {
  const ctx: ServerCtx = {
    server: null as unknown as net.Server,
    port: 0,
    nextCommandReply: null,
    queue: [],
    sockets: new Set(),
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
        if (cmd === '/login') {
          // 6.43+ empty-success: just !done with the tag.
          socket.write(encodeSentence(['!done', `.tag=${tag}`]));
          return;
        }
        // non-login: pull next scripted reply
        const script = ctx.queue.shift() ?? ctx.nextCommandReply;
        ctx.nextCommandReply = null;
        if (!script) {
          socket.write(encodeSentence(['!done', `.tag=${tag}`]));
          return;
        }
        const chunks = script(tag);
        for (const c of chunks) socket.write(c);
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

// -------------------- Tests --------------------

describe('RouterOS !empty reply (7.18+)', () => {
  let ctx: ServerCtx;

  beforeEach(async () => {
    ctx = await startServer();
  });

  afterEach(async () => {
    await stopServer(ctx);
  });

  async function connect() {
    const client = new RouterOSClient({
      host: '127.0.0.1',
      port: ctx.port,
      user: 'u',
      password: 'p',
      timeout: 5,
    });
    // Swallow post-connect error events (socket close on teardown) so
    // uncaughtException does not bubble up.
    client.on?.('error', () => {});
    const api = await client.connect();
    return { client, api };
  }

  it('resolves [] when !empty and !done arrive in one TCP write', async () => {
    ctx.queue.push((tag) =>
      [Buffer.concat([
        encodeSentence(['!empty', `.tag=${tag}`]),
        encodeSentence(['!done', `.tag=${tag}`]),
      ])],
    );
    const { client, api } = await connect();
    try {
      const rows = await api.menu('/ip/hotspot/active').get();
      expect(rows).toEqual([]);
    } finally {
      await client.close().catch(() => {});
    }
  });

  it('resolves [] when !empty and !done are in two writes with a gap, and does not resolve early', async () => {
    // Scripted reply writes !empty immediately, then schedules !done ~60 ms
    // later as a separate TCP write via setTimeout.
    ctx.queue.push((tag) => {
      // Grab the live socket and schedule a second packet.
      const live = Array.from(ctx.sockets)[0];
      setTimeout(() => {
        try { live.write(encodeSentence(['!done', `.tag=${tag}`])); } catch { /* ignore */ }
      }, 60);
      return [encodeSentence(['!empty', `.tag=${tag}`])];
    });
    const { client, api } = await connect();
    try {
      let resolvedAt = 0;
      const t0 = Date.now();
      const p = api.menu('/ip/hotspot/active').get().then((rows: unknown) => {
        resolvedAt = Date.now() - t0;
        return rows;
      });
      // After 20 ms the request must still be pending.
      await new Promise((r) => setTimeout(r, 20));
      expect(resolvedAt).toBe(0);
      const rows = await p;
      expect(rows).toEqual([]);
      expect(resolvedAt).toBeGreaterThanOrEqual(40);
    } finally {
      await client.close().catch(() => {});
    }
  });

  it('after an !empty reply, a subsequent normal list on the same connection still returns its rows', async () => {
    ctx.queue.push((tag) =>
      [Buffer.concat([
        encodeSentence(['!empty', `.tag=${tag}`]),
        encodeSentence(['!done', `.tag=${tag}`]),
      ])],
    );
    ctx.queue.push((tag) =>
      [Buffer.concat([
        encodeSentence(['!re', '=name=hs1', '=interface=ether2', `.tag=${tag}`]),
        encodeSentence(['!re', '=name=hs2', '=interface=ether3', `.tag=${tag}`]),
        encodeSentence(['!done', `.tag=${tag}`]),
      ])],
    );
    const { client, api } = await connect();
    try {
      const empty = await api.menu('/ip/hotspot/active').get();
      expect(empty).toEqual([]);
      const rows = await api.menu('/ip/hotspot').get();
      expect(rows).toHaveLength(2);
      expect(rows[0].name).toBe('hs1');
      expect(rows[1].interface).toBe('ether3');
    } finally {
      await client.close().catch(() => {});
    }
  });

  it('!trap still rejects', async () => {
    ctx.queue.push((tag) =>
      [Buffer.concat([
        encodeSentence(['!trap', '=message=boom', `.tag=${tag}`]),
        encodeSentence(['!done', `.tag=${tag}`]),
      ])],
    );
    const { client, api } = await connect();
    try {
      await expect(api.menu('/ip/hotspot/active').get()).rejects.toThrow(/boom/);
    } finally {
      await client.close().catch(() => {});
    }
  });

  it('real listHotspotServers() returns [] on !empty, and resolveActiveServerProfileNames() returns ["default"]', async () => {
    // listHotspotServers hits /ip/hotspot → !empty
    ctx.queue.push((tag) =>
      [Buffer.concat([
        encodeSentence(['!empty', `.tag=${tag}`]),
        encodeSentence(['!done', `.tag=${tag}`]),
      ])],
    );
    // resolveActiveServerProfileNames calls listHotspotServers again
    ctx.queue.push((tag) =>
      [Buffer.concat([
        encodeSentence(['!empty', `.tag=${tag}`]),
        encodeSentence(['!done', `.tag=${tag}`]),
      ])],
    );
    const { client, api } = await connect();
    try {
      const svc = await import('../../services/routerOs.service');
      const servers = await svc.listHotspotServers(api);
      expect(servers).toEqual([]);
      const names = await svc.resolveActiveServerProfileNames(api);
      expect(names).toEqual(['default']);
    } finally {
      await client.close().catch(() => {});
    }
  });
});
