import { Router } from 'express';
import { scriptCallback } from '../controllers/router.controller';

const router = Router();

/**
 * GET /api/v1/public/routers/script-callback
 *
 * Called by the RouterOS `/tool fetch` command in setup step 7.
 * No JWT auth — authenticated by HMAC-SHA256 signature in the `sig` query param.
 * Always returns 200 so the router-side fetch command does not report an error.
 */
router.get('/script-callback', scriptCallback);

export default router;
