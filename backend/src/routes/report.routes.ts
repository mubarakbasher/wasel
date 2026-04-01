import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireSubscription } from '../middleware/requireSubscription';
import { requireTier } from '../middleware/requireTier';
import { validate } from '../middleware/validate';
import { reportQuerySchema, exportQuerySchema } from '../validators/report.validators';
import * as reportController from '../controllers/report.controller';

const router = Router();

router.get('/', authenticate, requireSubscription, requireTier('professional', 'enterprise'), validate({ query: reportQuerySchema }), reportController.getReport);
router.get('/export', authenticate, requireSubscription, requireTier('professional', 'enterprise'), validate({ query: exportQuerySchema }), reportController.exportReport);

export default router;
