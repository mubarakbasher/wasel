import { pool } from '../config/database';
import logger from '../config/logger';
import { provisionRouter, ProvisionResult } from '../services/routerProvision.service';

interface BrokenRouterRow {
  id: string;
  name: string;
  user_id: string;
  tunnel_ip: string | null;
  last_provision_status: string | null;
  last_provision_error: unknown;
  provision_applied_at: Date | null;
}

interface FailureRecord {
  routerId: string;
  routerName: string;
  status: string;
  errors: ProvisionResult['errors'];
}

async function main(): Promise<void> {
  const result = await pool.query<BrokenRouterRow>(
    `SELECT id, name, user_id, tunnel_ip,
            last_provision_status, last_provision_error, provision_applied_at
       FROM routers
      WHERE tunnel_ip IS NOT NULL
        AND (provision_applied_at IS NULL OR last_provision_status != 'succeeded')
      ORDER BY name`,
  );

  const routers = result.rows;
  process.stdout.write(`\nFound ${routers.length} router(s) needing re-provision.\n\n`);

  if (routers.length === 0) {
    process.stdout.write('Nothing to do. Exiting.\n');
    await pool.end();
    return;
  }

  let succeeded = 0;
  let failed = 0;
  const failures: FailureRecord[] = [];

  for (const router of routers) {
    const prevStatus = router.last_provision_status ?? 'pending';
    const idShort = router.id.slice(0, 8);
    const nameCol = router.name.padEnd(28);
    process.stdout.write(`[${idShort}] ${nameCol} ${prevStatus.padEnd(10)} -> `);

    try {
      const provResult = await provisionRouter(router.user_id, router.id, { trigger: 'manual' });
      if (provResult.status === 'succeeded') {
        succeeded++;
        process.stdout.write('succeeded\n');
      } else {
        failed++;
        const stepNames = provResult.errors.map((e) => e.step).join(', ');
        process.stdout.write(`${provResult.status} (failed steps: ${stepNames})\n`);
        failures.push({
          routerId: router.id,
          routerName: router.name,
          status: provResult.status,
          errors: provResult.errors,
        });
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`THREW: ${msg}\n`);
      failures.push({
        routerId: router.id,
        routerName: router.name,
        status: 'thrown',
        errors: [{ step: 'reprovision-script', error: msg }],
      });
    }
  }

  process.stdout.write(`\n${'='.repeat(60)}\n`);
  process.stdout.write(`Re-provision complete: ${succeeded} succeeded, ${failed} failed/partial\n`);

  if (failures.length > 0) {
    process.stdout.write(`\nFailure details:\n`);
    for (const f of failures) {
      process.stdout.write(`\n  ${f.routerName} (${f.routerId})  status=${f.status}\n`);
      for (const e of f.errors) {
        process.stdout.write(`    - ${e.step}: ${e.error}\n`);
      }
    }
  }
  process.stdout.write('\n');
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error('reprovisionBroken script failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.stderr.write(`FATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(1);
  });
