import type { PoolClient } from 'pg';
import logger from '../config/logger';

export async function recordCardBatch(
  client: PoolClient,
  b: {
    userId: string;
    routerId: string;
    cardCount: number;
    price: number | null;
    limitType: string | null;
  },
): Promise<void> {
  try {
    await client.query('SAVEPOINT analytics_cards');
    await client.query(
      `INSERT INTO analytics_card_batches (user_id, router_id, created_at, card_count, price, limit_type)
       VALUES ($1, $2, NOW(), $3, $4, $5)`,
      [b.userId, b.routerId, b.cardCount, b.price, b.limitType],
    );
    await client.query('RELEASE SAVEPOINT analytics_cards');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT analytics_cards').catch(() => undefined);
    logger.error('recordCardBatch failed', { err });
  }
}
