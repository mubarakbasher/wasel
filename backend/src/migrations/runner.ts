import fs from 'fs';
import path from 'path';
import { pool } from '../config/database';
import logger from '../config/logger';

const SQL_DIR = path.join(__dirname, 'sql');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getExecutedMigrations(): Promise<Set<string>> {
  const result = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY filename'
  );
  return new Set(result.rows.map((row) => row.filename));
}

function getPendingSqlFiles(executed: Set<string>): string[] {
  if (!fs.existsSync(SQL_DIR)) {
    logger.warn('Migrations SQL directory does not exist', { path: SQL_DIR });
    return [];
  }

  const files = fs.readdirSync(SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return files.filter((f) => !executed.has(f));
}

export async function runMigrations(): Promise<void> {
  logger.info('Starting database migrations');

  await ensureMigrationsTable();

  const executed = await getExecutedMigrations();
  logger.info(`Found ${executed.size} already-executed migration(s)`);

  const pending = getPendingSqlFiles(executed);

  if (pending.length === 0) {
    logger.info('No pending migrations');
    return;
  }

  logger.info(`Found ${pending.length} pending migration(s)`, { files: pending });

  for (const filename of pending) {
    const filePath = path.join(SQL_DIR, filename);
    const sql = fs.readFileSync(filePath, 'utf-8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [filename]
      );
      await client.query('COMMIT');
      logger.info(`Migration executed successfully: ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`Migration failed: ${filename}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      client.release();
    }
  }

  logger.info(`All ${pending.length} migration(s) completed successfully`);
}
