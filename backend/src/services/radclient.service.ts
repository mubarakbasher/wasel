import { spawn } from 'child_process';
import logger from '../config/logger';

export type RadiusAuthResult = 'accept' | 'reject' | 'timeout';

export interface SendAccessRequestParams {
  secret: string;
  nasIp: string;
  username: string;
  password: string;
  /** Overall deadline in ms. Defaults to 3× radclient -t plus buffer. */
  timeoutMs?: number;
}

/**
 * Send a single Access-Request to the local FreeRADIUS instance and
 * return the outcome.
 *
 * FreeRADIUS and the backend both run in `network_mode: host`, so
 * 127.0.0.1:1812 is the local server. The NAS-IP-Address attribute
 * selects which `nas` row's shared secret FreeRADIUS will use to
 * validate the packet — we populate it with the router's tunnel IP.
 *
 * A `timeout` return value (no reply at all) is the silent-failure
 * signal the health check looks for: it means FreeRADIUS either does
 * not have a matching nas row, or the shared secret doesn't match, and
 * therefore silently drops packets from that client.
 */
export async function sendAccessRequest(
  params: SendAccessRequestParams,
): Promise<RadiusAuthResult> {
  const { secret, nasIp, username, password } = params;
  const timeoutMs = params.timeoutMs ?? 3_000;

  return new Promise<RadiusAuthResult>((resolve) => {
    // `-x` single-level debug (needed so radclient prints the reply type),
    // `-t 2` per-retry timeout, `-r 1` one attempt (radclient's default is 3).
    const args = [
      '-x',
      '-t',
      String(Math.max(1, Math.floor(timeoutMs / 1000))),
      '-r',
      '1',
      '127.0.0.1:1812',
      'auth',
      secret,
    ];

    const child = spawn('radclient', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const killTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* best-effort */ }
      resolve('timeout');
    }, timeoutMs + 1_000);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      logger.warn('radclient spawn failed', { error: err.message });
      resolve('timeout');
    });

    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);

      const combined = `${stdout}\n${stderr}`;
      if (/Access-Accept/i.test(combined)) {
        resolve('accept');
      } else if (/Access-Reject/i.test(combined)) {
        resolve('reject');
      } else if (/no reply|timed out|no response/i.test(combined)) {
        resolve('timeout');
      } else {
        // Unknown output — treat as timeout so the caller flags it as a
        // problem rather than silently believing the router is healthy.
        resolve('timeout');
      }
    });

    // radclient reads one request per line on stdin and closes on EOF.
    const userAttr = username.replace(/"/g, '\\"');
    const passAttr = password.replace(/"/g, '\\"');
    const body = `User-Name="${userAttr}",User-Password="${passAttr}",NAS-IP-Address=${nasIp}\n`;
    child.stdin.write(body);
    child.stdin.end();
  });
}

export type CoaDisconnectResult = 'ack' | 'nak' | 'timeout';

export interface SendDisconnectRequestParams {
  /** Per-NAS shared secret (from the `nas` table). */
  secret: string;
  /** Router's tunnel IP (NAS reachable on UDP/3799 over WireGuard). */
  nasIp: string;
  /** Voucher username whose session should be terminated. */
  username: string;
  /** Acct-Session-Id from radacct — required to identify the exact session. */
  acctSessionId?: string;
  /** Framed IP of the client (optional, helps router resolve session). */
  framedIp?: string;
  /** CoA listener port on the router. Defaults to RFC 5176 standard 3799. */
  port?: number;
  /** Overall deadline in ms. */
  timeoutMs?: number;
}

/**
 * Send a CoA Disconnect-Request (RFC 5176) to a router so it terminates the
 * named user's active hotspot session. Used by jobs that detect validity
 * expiry mid-session — without this, an active session would continue until
 * the router's idle-timeout or until the user manually disconnects.
 *
 * Returns 'ack' on Disconnect-ACK, 'nak' on Disconnect-NAK (router refused —
 * usually because the session vanished between the SQL query and the packet),
 * 'timeout' if the router did not reply within timeoutMs (firewall, wrong
 * secret, or router offline).
 */
export async function sendDisconnectRequest(
  params: SendDisconnectRequestParams,
): Promise<CoaDisconnectResult> {
  const { secret, nasIp, username, acctSessionId, framedIp } = params;
  const port = params.port ?? 3799;
  const timeoutMs = params.timeoutMs ?? 3_000;

  return new Promise<CoaDisconnectResult>((resolve) => {
    const args = [
      '-x',
      '-t',
      String(Math.max(1, Math.floor(timeoutMs / 1000))),
      '-r',
      '1',
      `${nasIp}:${port}`,
      'disconnect',
      secret,
    ];

    const child = spawn('radclient', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const killTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* best-effort */ }
      resolve('timeout');
    }, timeoutMs + 1_000);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      logger.warn('radclient disconnect spawn failed', { error: err.message });
      resolve('timeout');
    });

    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);

      const combined = `${stdout}\n${stderr}`;
      if (/Disconnect-ACK/i.test(combined)) {
        resolve('ack');
      } else if (/Disconnect-NAK/i.test(combined)) {
        resolve('nak');
      } else {
        resolve('timeout');
      }
    });

    const userAttr = username.replace(/"/g, '\\"');
    const parts: string[] = [`User-Name="${userAttr}"`, `NAS-IP-Address=${nasIp}`];
    if (acctSessionId) {
      const sid = acctSessionId.replace(/"/g, '\\"');
      parts.push(`Acct-Session-Id="${sid}"`);
    }
    if (framedIp) {
      parts.push(`Framed-IP-Address=${framedIp}`);
    }
    child.stdin.write(parts.join(',') + '\n');
    child.stdin.end();
  });
}
