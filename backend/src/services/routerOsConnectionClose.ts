/**
 * routerOsConnectionClose.ts — library-level patch for `node-routeros`.
 *
 * Background
 * ----------
 * node-routeros 1.6.8 settles a per-command Channel only on `!done` or
 * `!trap` (see node_modules/node-routeros/dist/Channel.js lines 67-69).
 * RouterOSAPI's `connect()` wires a `close` listener on the Connector that
 * calls `endListener()` with no argument (RouterOSAPI.js:91-94). That means:
 *
 *   - If the router closes the socket mid-command, nothing on the pending
 *     Channel fires — `.get()` never settles.
 *   - If the socket closes during `/login`, `endListener()` runs with no
 *     `e`, so the `connect()` promise is never rejected either
 *     (RouterOSAPI.js:91-94, 114-118, 393-401). The rescue path works
 *     because `connect()` itself is not directly awaited by the library on
 *     close; it rejects because the `/login` write goes through
 *     `openChannel()`, is tracked as a pending channel, and receives the
 *     synthetic `trap` sentence we inject, which propagates through
 *     `login().catch` and finally rejects the `connect()` promise.
 *   - When keepalive is on, `holdConnection()` schedules a new '#' channel
 *     with `new Channel(...)` and only re-arms on `.catch` — on a dead
 *     socket the write never resolves, but the timer already re-arms on
 *     reject, so a silently dropped socket leaves the channel's promise
 *     orphaned forever (RouterOSAPI.js:299-325).
 *
 * The prod effect: the hourly NTP sweep gets stuck on one router and the
 * `running` flag is never cleared until the backend restarts.
 *
 * What this patches
 * -----------------
 * Same style as `routerOsEmptyReply.ts`: a one-time, idempotent prototype
 * wrap applied to `node-routeros`' own `RouterOSAPI` (NOT the thin
 * `routeros-client` wrapper that some tests mock). Imported for its side
 * effects from `routerOs.service.ts`.
 *
 *  1. `openChannel()` wrapper tracks every Channel it returns in a per-
 *     instance Set, removing each on its `close` event. The internal '#'
 *     keepalive channel is deliberately NOT tracked — it is created with
 *     `new Channel(connector)` in `holdConnection()`, not via
 *     `openChannel()`. Rejecting it would call back into
 *     `holdConnInterval()` which re-arms the keepalive timer on a dead
 *     socket (an infinite loop).
 *
 *  2. `connect()` wrapper runs the original synchronously (it is the one
 *     that creates `this.connector` and the raw `socket`) and, before
 *     returning the promise, attaches `socket.once('close', ...)` on the
 *     RAW socket. We keep `connector` captured in the closure because
 *     RouterOSAPI's own `close()` nulls `this.connector = null`
 *     (RouterOSAPI.js:258-266) before all handlers have run.
 *
 *     'close' fires on every path — remote FIN, RST, socket timeout, and
 *     local `destroy()` — exactly what we need. We cannot hook events on
 *     the Connector object itself because `Connector.destroy()` calls
 *     `removeAllListeners()` (Connector.js:139).
 *
 *  3. On the raw-socket 'close':
 *       - Clear `connected` / `connecting`.
 *       - Clear `connectionHoldInterval` and `keptaliveby` (`clearTimeout`
 *         on both — they are `setTimeout` handles in node-routeros, not
 *         intervals).
 *       - For each tracked Channel, emit `trap` with a synthetic
 *         `{ message: 'RouterOS connection closed' }` so the pending
 *         `.write()` promise rejects, then call `channel.close(true)` so
 *         the library's own decreaseChannelsOpen/releaseConnectionHold
 *         bookkeeping runs (`write()` wires its `close` listener in
 *         RouterOSAPI.js:135-139).
 *
 *     NOTE: we deliberately only close channels AFTER the socket has
 *     already closed. If we closed them while the socket was still alive,
 *     the Receiver would later feed a reply for a tag that is no longer
 *     registered and `Receiver.sendTagData` would throw UNREGISTEREDTAG
 *     inside the socket data callback — uncatchable, backend exits.
 *
 * Fields on `RouterOSAPI`/`Channel` are TypeScript-private; we cast to
 * `any` the same way routerOsEmptyReply.ts does. The patch is idempotent:
 * double-importing is a no-op.
 *
 * node-routeros is pinned exactly in package.json because this wraps
 * private internals. Patch tests exercise it end-to-end against a real
 * TCP mini-RouterOS harness.
 */
import { RouterOSAPI } from 'node-routeros';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface PatchedProto {
  openChannel: (...args: any[]) => any;
  connect: (...args: any[]) => any;
  __waselConnectionClosePatched?: boolean;
}

const proto = RouterOSAPI.prototype as unknown as PatchedProto;

// Per-instance Set is stored on the RouterOSAPI instance under this symbol.
const CHANNELS_SYM: unique symbol = Symbol.for('wasel.routeros.openChannels');

if (!proto.__waselConnectionClosePatched) {
  const originalOpenChannel = proto.openChannel;
  const originalConnect = proto.connect;

  proto.openChannel = function (this: any, ...args: any[]): any {
    const ch = originalOpenChannel.apply(this, args);
    try {
      let set: Set<any> | undefined = this[CHANNELS_SYM as any];
      if (!set) {
        set = new Set<any>();
        this[CHANNELS_SYM as any] = set;
      }
      set.add(ch);
      ch.once('close', () => {
        set!.delete(ch);
      });
    } catch {
      // Never let bookkeeping throw into the caller.
    }
    return ch;
  };

  proto.connect = function (this: any, ...args: any[]): any {
    const result = originalConnect.apply(this, args);

    // The original connect() synchronously constructs `this.connector` and,
    // via `this.connector.connect()`, the raw socket. The socket exists on
    // `this.connector.socket` before the Promise ever resolves, so we can
    // attach our handler now and still catch a close that happens during
    // /login (before `connected = true`).
    try {
      const connector = this.connector;
      const socket = connector?.socket;
      if (!connector || !socket || (socket as any).__waselCloseHooked) {
        return result;
      }
      (socket as any).__waselCloseHooked = true;

      socket.once('close', () => {
        // Snapshot tracked channels BEFORE mutating bookkeeping so a late
        // listener-removal cannot race us.
        const set: Set<any> | undefined = this[CHANNELS_SYM as any];
        const channels = set ? Array.from(set) : [];

        try {
          this.connected = false;
          this.connecting = false;
          if (this.connectionHoldInterval) {
            clearTimeout(this.connectionHoldInterval);
            this.connectionHoldInterval = undefined;
          }
          if (this.keptaliveby) {
            clearTimeout(this.keptaliveby);
            this.keptaliveby = undefined;
          }
        } catch {
          // ignore
        }

        for (const ch of channels) {
          try {
            // Reject the pending .write() promise. Channel.write() wires
            // `.once('trap', ...)` → rejects with a plain Error.
            ch.emit('trap', { message: 'RouterOS connection closed' });
          } catch {
            // ignore
          }
          try {
            // `close(true)` removes all listeners (we're past the write)
            // and triggers Channel's own 'close' event, which the
            // RouterOSAPI.write() wrapper uses to run
            // decreaseChannelsOpen / releaseConnectionHold.
            ch.close(true);
          } catch {
            // ignore
          }
          if (set) set.delete(ch);
        }
      });
    } catch {
      // If anything about the internals changed, don't break connect().
    }

    return result;
  };

  proto.__waselConnectionClosePatched = true;
}
