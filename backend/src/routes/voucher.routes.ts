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
  listVoucherBatchesQuerySchema,
  bulkDeleteVouchersSchema,
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

// Bulk delete vouchers (must be before /:vid routes)
router.post(
  '/bulk-delete',
  authenticate,
  requireSubscription,
  validate({ params: routerIdParamSchema, body: bulkDeleteVouchersSchema }),
  voucherController.bulkDeleteVouchers,
);

// List creation batches — must be before /:vid so 'batches' is not parsed as a UUID param.
// Same ordering note as bulk-delete above.
router.get(
  '/batches',
  authenticate,
  requireSubscription,
  validate({ params: routerIdParamSchema, query: listVoucherBatchesQuerySchema }),
  voucherController.getVoucherBatches,
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
