import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireSubscription } from '../middleware/requireSubscription';
import { checkQuota } from '../middleware/checkQuota';
import { validate } from '../middleware/validate';
import {
  routerIdParamSchema,
  voucherIdParamSchema,
  createVouchersSchema,
  updateVoucherSchema,
  listVouchersQuerySchema,
} from '../validators/voucher.validators';
import * as voucherController from '../controllers/voucher.controller';
import { AuthenticatedRequest } from '../types';

const router = Router({ mergeParams: true });

// All routes require authentication + active subscription
// Routes are mounted under /routers/:id/vouchers

// Create vouchers (unified: single or bulk based on count)
router.post(
  '/',
  authenticate,
  requireSubscription,
  validate({ params: routerIdParamSchema, body: createVouchersSchema }),
  checkQuota((req: AuthenticatedRequest) => req.body.count || 1),
  voucherController.createVouchers,
);

// List vouchers for a router
router.get(
  '/',
  authenticate,
  requireSubscription,
  validate({ params: routerIdParamSchema, query: listVouchersQuerySchema }),
  voucherController.getVouchers,
);

// Get single voucher
router.get(
  '/:vid',
  authenticate,
  requireSubscription,
  validate({ params: voucherIdParamSchema }),
  voucherController.getVoucher,
);

// Update voucher (enable/disable/extend)
router.put(
  '/:vid',
  authenticate,
  requireSubscription,
  validate({ params: voucherIdParamSchema, body: updateVoucherSchema }),
  voucherController.updateVoucher,
);

// Delete voucher (with CoA disconnect)
router.delete(
  '/:vid',
  authenticate,
  requireSubscription,
  validate({ params: voucherIdParamSchema }),
  voucherController.deleteVoucher,
);

export default router;
