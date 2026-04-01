import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireSubscription } from '../middleware/requireSubscription';
import { validate } from '../middleware/validate';
import { reportQuerySchema, exportQuerySchema } from '../validators/report.validators';
import * as reportController from '../controllers/report.controller';

const router = Router();

router.get('/', authenticate, requireSubscription, validate({ query: reportQuerySchema }), reportController.getReport);
router.get('/export', authenticate, requireSubscription, validate({ query: exportQuerySchema }), reportController.exportReport);

export default router;
