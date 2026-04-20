import { Router, Request, Response } from 'express';
import authRoutes from './auth.routes';
import subscriptionRoutes from './subscription.routes';
import routerRoutes from './router.routes';
import profileRoutes from './profile.routes';
import voucherRoutes from './voucher.routes';
import sessionRoutes from './session.routes';
import dashboardRoutes from './dashboard.routes';
import reportRoutes from './report.routes';
import notificationRoutes from './notification.routes';
import supportRoutes from './support.routes';
import adminRoutes from './admin.routes';
import { pool } from '../config/database';
import { redis } from '../config/redis';
import logger from '../config/logger';

const router = Router();

const HEALTH_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    ),
  ]);
}

async function checkDb(): Promise<'ok' | 'fail'> {
  try {
    const client = await withTimeout(pool.connect(), HEALTH_TIMEOUT_MS);
    try {
      await withTimeout(client.query('SELECT 1'), HEALTH_TIMEOUT_MS);
    } finally {
      client.release();
    }
    return 'ok';
  } catch (err) {
    logger.warn('Health: DB check failed', { error: (err as Error).message });
    return 'fail';
  }
}

async function checkRedis(): Promise<'ok' | 'fail'> {
  try {
    const reply = await withTimeout(redis.ping(), HEALTH_TIMEOUT_MS);
    return reply === 'PONG' ? 'ok' : 'fail';
  } catch (err) {
    logger.warn('Health: Redis check failed', { error: (err as Error).message });
    return 'fail';
  }
}

async function healthHandler(_req: Request, res: Response): Promise<void> {
  const [db, redisStatus] = await Promise.all([checkDb(), checkRedis()]);
  const checks = { db, redis: redisStatus };
  const healthy = db === 'ok' && redisStatus === 'ok';
  res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: {
      status: healthy ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    },
  });
}

// Health check — no auth required
router.get('/health', healthHandler);
router.get('/readyz', healthHandler);

// Route groups
router.use('/auth', authRoutes);
router.use('/subscription', subscriptionRoutes);
router.use('/routers', routerRoutes);
router.use('/profiles', profileRoutes);
router.use('/routers/:id/vouchers', voucherRoutes);
router.use('/routers/:id/sessions', sessionRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/reports', reportRoutes);
router.use('/notifications', notificationRoutes);
router.use('/support', supportRoutes);
router.use('/admin', adminRoutes);

export default router;
