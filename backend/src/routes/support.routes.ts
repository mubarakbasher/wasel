import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  sendMessageSchema,
  listMessagesQuerySchema,
} from '../validators/support.validators';
import * as supportController from '../controllers/support.controller';

const router = Router();

router.use(authenticate);

router.get('/messages', validate({ query: listMessagesQuerySchema }), supportController.listMessages);
router.post('/messages', validate({ body: sendMessageSchema }), supportController.sendMessage);
router.post('/messages/read-all', supportController.markAllRead);

export default router;
