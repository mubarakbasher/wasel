import { Response, NextFunction } from 'express';
import logger from '../config/logger';
import { AuthenticatedRequest } from '../types';

export function requestLogger(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      requestId: req.requestId,
      method: req.method,
      // Receipt links carry a live signature in the query string; keep the path only.
      url: req.originalUrl.toLowerCase().startsWith('/api/v1/receipts/') ? req.originalUrl.split('?')[0] : req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
  });

  next();
}
