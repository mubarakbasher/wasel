import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireSubscription } from '../middleware/requireSubscription';
import { requireTier } from '../middleware/requireTier';
import { validate } from '../middleware/validate';
import { routerIdParamSchema, sessionIdParamSchema, sessionHistoryQuerySchema } from '../validators/session.validators';
import * as sessionController from '../controllers/session.controller';

const router = Router({ mergeParams: true });

router.get('/', authenticate, requireSubscription, validate({ params: routerIdParamSchema }), sessionController.getActiveSessions);
router.get('/history', authenticate, requireSubscription, requireTier('professional', 'enterprise'), validate({ params: routerIdParamSchema, query: sessionHistoryQuerySchema }), sessionController.getSessionHistory);
router.delete('/:sid', authenticate, requireSubscription, validate({ params: sessionIdParamSchema }), sessionController.disconnectSession);

export default router;
