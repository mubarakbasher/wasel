import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import { config } from './config';
import { requestIdMiddleware } from './middleware/requestId';
import { requestLogger } from './middleware/requestLogger';
import { generalLimiter } from './middleware/rateLimiter';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import routes from './routes';

const app = express();

// Trust X-Forwarded-For only when the socket peer is loopback, i.e. Nginx on the
// same host (see docs/deploy.md). WireGuard router peers reach the backend
// directly at 10.10.0.1:3000; they are not loopback, so Express uses their socket
// IP and ignores any X-Forwarded-For they send. Trusting a hop count of 1 let
// those direct callers forge req.ip. Behind Nginx, req.ip is the real client, so
// the per-IP rate limiters (generalLimiter, authLimiter) still key correctly.
app.set('trust proxy', 'loopback');

// Security headers
app.use(helmet());
app.use(
  helmet.hsts({
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  })
);

// CORS — wildcard '*' is rejected at config load time, so this is always a concrete allow-list.
app.use(
  cors({
    origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
    credentials: true,
  })
);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parsing — the admin SPA carries its refresh token in the HttpOnly
// `wasel_rt` cookie (Path=/api/v1/auth), so only the auth routes ever see it.
app.use(cookieParser());

// Prevent HTTP parameter pollution
app.use(hpp());

// Request ID and logging
app.use(requestIdMiddleware);
app.use(requestLogger);

// Rate limiting
app.use('/api/', generalLimiter);

// API v1 routes
app.use('/api/v1', routes);

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

export default app;
