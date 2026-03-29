import { pool } from '../config/database';
import { runMigrations } from '../migrations/runner';
import logger from '../config/logger';

async function main(): Promise<void> {
  try {
    await runMigrations();
    logger.info('Migration script completed successfully');
    await pool.end();
    process.exit(0);
  } catch (error) {
    logger.error('Migration script failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    await pool.end();
    process.exit(1);
  }
}

main();
