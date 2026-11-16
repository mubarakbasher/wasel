import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { cardSpeedUpdateSchema } from '../validators/cardSpeed.validators';
import * as cardSpeedController from '../controllers/cardSpeed.controller';

const router = Router();

router.get('/card-speed', authenticate, cardSpeedController.getCardSpeed);
router.put(
  '/card-speed',
  authenticate,
  validate({ body: cardSpeedUpdateSchema }),
  cardSpeedController.updateCardSpeed,
);

export default router;
