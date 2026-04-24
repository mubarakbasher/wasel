import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import * as validators from '../validators/admin.validators';
import * as adminController from '../controllers/admin.controller';
import * as settingsController from '../controllers/settings.controller';
import * as supportController from '../controllers/support.controller';
import {
  updateBankSettingsSchema,
  createAdminSchema,
  resetAdminPasswordSchema,
  adminIdParamSchema,
  setAdminActiveBodySchema,
} from '../validators/settings.validators';
import {
  sendMessageSchema,
  listMessagesQuerySchema,
  conversationUserIdParamSchema,
} from '../validators/support.validators';

const router = Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// Users
router.get('/users', validate({ query: validators.listUsersQuerySchema }), adminController.listUsers);
router.get('/users/:id', validate({ params: validators.userIdParamSchema }), adminController.getUserDetail);
router.put('/users/:id', validate({ params: validators.userIdParamSchema, body: validators.updateUserBodySchema }), adminController.updateUser);
router.delete('/users/:id', validate({ params: validators.userIdParamSchema }), adminController.deleteUser);
router.post(
  '/users/:id/routers',
  validate({ params: validators.userIdParamSchema, body: validators.createRouterForUserBodySchema }),
  adminController.createRouterForUser,
);

// Subscriptions
router.get('/subscriptions', validate({ query: validators.listSubscriptionsQuerySchema }), adminController.listSubscriptions);
router.put('/subscriptions/:id', validate({ params: validators.subscriptionIdParamSchema, body: validators.updateSubscriptionBodySchema }), adminController.updateSubscription);
router.delete('/subscriptions/:id', validate({ params: validators.subscriptionIdParamSchema }), adminController.deleteSubscription);

// Plans
router.get('/plans', adminController.listPlans);
router.post('/plans', validate({ body: validators.createPlanBodySchema }), adminController.createPlan);
router.put('/plans/:id', validate({ params: validators.planIdParamSchema, body: validators.updatePlanBodySchema }), adminController.updatePlan);
router.delete('/plans/:id', validate({ params: validators.planIdParamSchema }), adminController.deletePlan);

// Payments
router.get('/payments', validate({ query: validators.listPaymentsQuerySchema }), adminController.listPayments);
router.put('/payments/:id', validate({ params: validators.paymentIdParamSchema, body: validators.reviewPaymentBodySchema }), adminController.reviewPayment);

// Stats & Read-only
router.get('/stats', adminController.getStats);
router.get('/routers', validate({ query: validators.listRoutersQuerySchema }), adminController.listRouters);
router.get(
  '/routers/:id/setup-guide',
  validate({ params: validators.routerIdParamSchema }),
  adminController.getRouterSetupGuide,
);
router.get('/audit-logs', validate({ query: validators.listAuditLogsQuerySchema }), adminController.listAuditLogs);

// Settings — bank details
router.get('/settings/bank', settingsController.getBankSettings);
router.put(
  '/settings/bank',
  validate({ body: updateBankSettingsSchema }),
  settingsController.updateBankSettings,
);

// Admin management
router.get('/admins', adminController.listAdmins);
router.post('/admins', validate({ body: createAdminSchema }), adminController.createAdmin);
router.put(
  '/admins/:id/active',
  validate({ params: adminIdParamSchema, body: setAdminActiveBodySchema }),
  adminController.setAdminActive,
);
router.put(
  '/admins/:id/password',
  validate({ params: adminIdParamSchema, body: resetAdminPasswordSchema }),
  adminController.resetAdminPassword,
);
router.delete(
  '/admins/:id',
  validate({ params: adminIdParamSchema }),
  adminController.deleteAdmin,
);

// System status
router.get('/system-status', adminController.getSystemStatus);

// FreeRADIUS diagnostics / manual recovery — lets an admin unblock
// production (new NAS rows invisible to freeradius) without SSH access.
router.get('/freeradius/status', adminController.getFreeradiusStatus);
router.post('/freeradius/reload', adminController.reloadFreeradius);

// Support messages
router.get('/support/unread-count', supportController.adminUnreadCount);
router.get('/support/conversations', supportController.listConversations);
router.get(
  '/support/conversations/:userId',
  validate({ params: conversationUserIdParamSchema, query: listMessagesQuerySchema }),
  supportController.listConversationMessages,
);
router.post(
  '/support/conversations/:userId/messages',
  validate({ params: conversationUserIdParamSchema, body: sendMessageSchema }),
  supportController.adminReply,
);
router.post(
  '/support/conversations/:userId/read',
  validate({ params: conversationUserIdParamSchema }),
  supportController.adminMarkRead,
);

export default router;
