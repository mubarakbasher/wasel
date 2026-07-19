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

// Trust exactly one proxy hop (the Nginx reverse proxy that fronts this app in
// every deployed environment — see docs/deploy.md). With this set, Express
// derives `req.ip` from the rightmost X-Forwarded-For entry added by that single
// trusted hop, so the per-IP rate limiters (generalLimiter, authLimiter) key on
// the real client instead of collapsing every request onto Nginx's socket
// address. The hop count is pinned to `1` — NOT `true` — so a client cannot
// spoof `req.ip` by injecting its own X-Forwarded-For beyond the one hop Nginx
// overwrites.
app.set('trust proxy', 1);

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

// Static uploads (receipts, etc.).
// Uploads are magic-byte-verified images only (see middleware/upload.ts), so image
// extensions are safe to render inline; everything else stays a forced download.
// nosniff is always set regardless.
const INLINE_IMAGE_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
app.use(
  '/uploads',
  express.static(process.env.UPLOAD_DIR || '/app/uploads', {
    setHeaders: (res, path) => {
      res.setHeader(
        'Content-Disposition',
        INLINE_IMAGE_EXTENSIONS.test(path) ? 'inline' : 'attachment',
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }),
);

// API v1 routes
app.use('/api/v1', routes);

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

export default app;
