import { Router } from 'express';
import authRoutes from './auth.routes';
import subscriptionRoutes from './subscription.routes';
import routerRoutes from './router.routes';
import profileRoutes from './profile.routes';
import voucherRoutes from './voucher.routes';
import sessionRoutes from './session.routes';
import dashboardRoutes from './dashboard.routes';

const router = Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// Route groups
router.use('/auth', authRoutes);
router.use('/subscription', subscriptionRoutes);
router.use('/routers', routerRoutes);
router.use('/profiles', profileRoutes);
router.use('/routers/:id/vouchers', voucherRoutes);
router.use('/routers/:id/sessions', sessionRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;
