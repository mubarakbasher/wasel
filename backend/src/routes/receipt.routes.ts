import { Router } from 'express';
import { serveReceipt } from '../controllers/receipt.controller';

const router = Router();

// Public by design: access is gated by the HMAC-signed, expiring link itself.
router.get('/:name', serveReceipt);

export default router;
