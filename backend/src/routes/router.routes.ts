import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireSubscription } from '../middleware/requireSubscription';
import { validate } from '../middleware/validate';
import {
  createRouterSchema,
  updateRouterSchema,
  routerIdParamSchema,
  healthQuerySchema,
  confirmHotspotInterfaceSchema,
} from '../validators/router.validators';
import * as routerController from '../controllers/router.controller';

const router = Router();

// All routes require authentication + active subscription

router.post(
  '/',
  authenticate,
  requireSubscription,
  validate({ body: createRouterSchema }),
  routerController.createRouter,
);

router.get('/', authenticate, requireSubscription, routerController.getRouters);

router.get(
  '/:id',
  authenticate,
  requireSubscription,
  validate({ params: routerIdParamSchema }),
  routerController.getRouter,
);

router.put(
  '/:id',
  authenticate,
  requireSubscription,
  validate({ params: routerIdParamSchema, body: updateRouterSchema }),
  routerController.updateRouter,
);

router.delete(
  '/:id',
  authenticate,
  requireSubscription,
  validate({ params: routerIdParamSchema }),
  routerController.deleteRouter,
);

router.get(
  '/:id/status',
  authenticate,
  requireSubscription,
  validate({ params: routerIdParamSchema }),
  routerController.getRouterStatus,
);

router.get(
  '/:id/setup-guide',
  authenticate,
  requireSubscription,
  validate({ params: routerIdParamSchema }),
  routerController.getSetupGuide,
);

router.get(
  '/:id/health',
  authenticate,
  requireSubscription,
  validate({ params: routerIdParamSchema, query: healthQuerySchema }),
  routerController.getRouterHealth,
);

router.post(
  '/:id/reprovision',
  authenticate,
  requireSubscription,
  validate({ params: routerIdParamSchema }),
  routerController.reprovisionRouter,
);

router.post(
  '/:id/provision/hotspot',
  authenticate,
  requireSubscription,
  validate({ params: routerIdParamSchema, body: confirmHotspotInterfaceSchema }),
  routerController.confirmHotspot,
);

export default router;
