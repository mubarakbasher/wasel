import express from 'express';
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

// Security headers
app.use(helmet());
app.use(
  helmet.hsts({
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  })
);

// CORS
app.use(
  cors({
    origin: config.CORS_ORIGIN === '*'
      ? '*'
      : config.CORS_ORIGIN.split(',').map(s => s.trim()),
    credentials: true,
  })
);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
