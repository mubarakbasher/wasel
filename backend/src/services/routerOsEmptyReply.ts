/**
 * routerOsEmptyReply.ts — library-level patch for `node-routeros`.
 *
 * RouterOS 7.18+ answers a command that has no data with the reply word
 * `!empty`, followed by `!done`. `node-routeros` 1.6.8 does not recognise
 * `!empty`, and neither does 1.6.9, the newest release, so upgrading cannot fix
 * this: `Channel.processPacket` hits its `default:` branch, emits `unknown`,
 * and `onUnknown` throws
 * `RosException('UNKNOWNREPLY')`. That throw happens inside the socket data
 * callback, so no `try/catch` around `.get()` can catch it, and
 * `uncaughtException` tears the backend down. The throw also leaves
 * `Receiver.processingSentencePipe` stuck true, so swallowing it elsewhere
 * would wedge the connection.
 *
 * Fix: wrap `Channel.prototype.processPacket` so a packet whose first word is
 * `!empty` returns without calling the original. The following `!done` then
 * completes the request with `[]` — exactly what pre-7.18 RouterOS produced.
 * This has to live at library level because the throw is inside the socket
 * data callback; application code can't intervene any later than this.
 *
 * We import `Channel` from `node-routeros` (not `routeros-client`) because
 * some test files `vi.mock('routeros-client')` and a missing export on those
 * mocks would throw at import time.
 *
 * `node-routeros` is pinned exactly in package.json because this wraps a
 * private method. routerOs.emptyReply.test.ts fails if an upgrade breaks it.
 *
 * Patch is idempotent: double-importing is a no-op.
 */
import { Channel } from 'node-routeros';

interface PatchedProto {
  processPacket: (packet: string[]) => void;
  __waselEmptyReplyPatched?: boolean;
}

const proto = Channel.prototype as unknown as PatchedProto;

if (!proto.__waselEmptyReplyPatched) {
  const original = proto.processPacket;
  proto.processPacket = function (this: unknown, packet: string[]): void {
    if (packet.length > 0 && packet[0] === '!empty') {
      // Drop the sentinel; keep the channel open so the next `!done` resolves it.
      return;
    }
    return original.call(this, packet);
  };
  proto.__waselEmptyReplyPatched = true;
}
