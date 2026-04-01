import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import * as validators from '../validators/admin.validators';
import * as adminController from '../controllers/admin.controller';

const router = Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// Users
router.get('/users', validate({ query: validators.listUsersQuerySchema }), adminController.listUsers);
router.put('/users/:id', validate({ params: validators.userIdParamSchema, body: validators.updateUserBodySchema }), adminController.updateUser);
router.delete('/users/:id', validate({ params: validators.userIdParamSchema }), adminController.deleteUser);

// Subscriptions
router.get('/subscriptions', validate({ query: validators.listSubscriptionsQuerySchema }), adminController.listSubscriptions);
router.put('/subscriptions/:id', validate({ params: validators.subscriptionIdParamSchema, body: validators.updateSubscriptionBodySchema }), adminController.updateSubscription);

// Payments
router.get('/payments', validate({ query: validators.listPaymentsQuerySchema }), adminController.listPayments);
router.put('/payments/:id', validate({ params: validators.paymentIdParamSchema, body: validators.reviewPaymentBodySchema }), adminController.reviewPayment);

// Stats & Read-only
router.get('/stats', adminController.getStats);
router.get('/routers', validate({ query: validators.listRoutersQuerySchema }), adminController.listRouters);
router.get('/audit-logs', validate({ query: validators.listAuditLogsQuerySchema }), adminController.listAuditLogs);

export default router;
