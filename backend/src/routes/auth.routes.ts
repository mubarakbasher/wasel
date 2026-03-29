import { Router } from 'express';
import { authLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  logoutSchema,
} from '../validators/auth.validators';
import * as authController from '../controllers/auth.controller';

const router = Router();

router.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  authController.register,
);

router.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  authController.login,
);

router.post(
  '/refresh',
  authLimiter,
  validate({ body: refreshSchema }),
  authController.refresh,
);

router.post(
  '/verify-email',
  authLimiter,
  validate({ body: verifyEmailSchema }),
  authController.verifyEmail,
);

router.post(
  '/forgot-password',
  authLimiter,
  validate({ body: forgotPasswordSchema }),
  authController.forgotPassword,
);

router.post(
  '/reset-password',
  authLimiter,
  validate({ body: resetPasswordSchema }),
  authController.resetPassword,
);

router.post(
  '/logout',
  validate({ body: logoutSchema }),
  authController.logout,
);

export default router;
