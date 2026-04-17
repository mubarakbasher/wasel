import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  registerDeviceTokenSchema,
  unregisterDeviceTokenSchema,
  updatePreferencesSchema,
  listInboxQuerySchema,
  notificationIdParamSchema,
} from '../validators/notification.validators';
import * as notificationController from '../controllers/notification.controller';

const router = Router();

router.post('/device-token', authenticate, validate({ body: registerDeviceTokenSchema }), notificationController.registerToken);
router.delete('/device-token', authenticate, validate({ body: unregisterDeviceTokenSchema }), notificationController.unregisterToken);
router.get('/preferences', authenticate, notificationController.getPreferences);
router.put('/preferences', authenticate, validate({ body: updatePreferencesSchema }), notificationController.updatePreferences);

// In-app inbox
router.get('/', authenticate, validate({ query: listInboxQuerySchema }), notificationController.listInbox);
router.post('/read-all', authenticate, notificationController.markAllNotificationsRead);
router.post('/:id/read', authenticate, validate({ params: notificationIdParamSchema }), notificationController.markNotificationRead);
router.delete('/:id', authenticate, validate({ params: notificationIdParamSchema }), notificationController.deleteNotification);

export default router;
