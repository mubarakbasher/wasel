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
