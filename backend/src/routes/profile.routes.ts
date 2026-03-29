import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireSubscription } from '../middleware/requireSubscription';
import { validate } from '../middleware/validate';
import {
  createProfileSchema,
  updateProfileSchema,
  profileIdParamSchema,
} from '../validators/profile.validators';
import * as profileController from '../controllers/profile.controller';

const router = Router();

// All routes require authentication + active subscription

router.post(
  '/',
  authenticate,
  requireSubscription,
  validate({ body: createProfileSchema }),
  profileController.createProfile,
);

router.get('/', authenticate, requireSubscription, profileController.getProfiles);

router.get(
  '/:pid',
  authenticate,
  requireSubscription,
  validate({ params: profileIdParamSchema }),
  profileController.getProfile,
);

router.put(
  '/:pid',
  authenticate,
  requireSubscription,
  validate({ params: profileIdParamSchema, body: updateProfileSchema }),
  profileController.updateProfile,
);

router.delete(
  '/:pid',
  authenticate,
  requireSubscription,
  validate({ params: profileIdParamSchema }),
  profileController.deleteProfile,
);

export default router;
