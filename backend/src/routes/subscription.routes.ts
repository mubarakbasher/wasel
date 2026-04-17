import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { uploadReceipt as uploadReceiptMiddleware } from '../middleware/upload';
import {
  requestSubscriptionSchema,
  changeSubscriptionSchema,
  uploadReceiptSchema,
} from '../validators/subscription.validators';
import * as subscriptionController from '../controllers/subscription.controller';

const router = Router();

// Public
router.get('/plans', subscriptionController.getPlans);

// Protected
router.get('/', authenticate, subscriptionController.getSubscription);

router.get('/payments', authenticate, subscriptionController.getUserPayments);

router.post(
  '/request',
  authenticate,
  validate({ body: requestSubscriptionSchema }),
  subscriptionController.requestSubscription,
);

router.post(
  '/change',
  authenticate,
  validate({ body: changeSubscriptionSchema }),
  subscriptionController.changeSubscription,
);

router.post(
  '/receipt',
  authenticate,
  uploadReceiptMiddleware.single('receipt'),
  validate({ body: uploadReceiptSchema }),
  subscriptionController.uploadReceipt,
);

export default router;
