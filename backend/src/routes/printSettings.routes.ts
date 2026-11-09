import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { printSettingsSchema } from '../validators/printSettings.validators';
import * as printSettingsController from '../controllers/printSettings.controller';

const router = Router();

router.get('/print', authenticate, printSettingsController.getSettings);
router.put(
  '/print',
  authenticate,
  validate({ body: printSettingsSchema }),
  printSettingsController.updateSettings,
);

export default router;
