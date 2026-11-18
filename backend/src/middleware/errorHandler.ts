import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';
import { config } from '../config';
import { Sentry } from '../config/sentry';
import { ErrorCodes } from '../utils/errorCodes';

/** Report an error to Sentry with request context (no-op when Sentry is unconfigured). */
function captureError(err: Error, req: Request): void {
  Sentry.withScope((scope) => {
    const r = req as Request & { requestId?: string; user?: { id: number | string } };
    if (r.requestId) scope.setTag('request_id', r.requestId);
    if (r.user?.id) scope.setUser({ id: String(r.user.id) });
    scope.setContext('request', { method: req.method, url: req.originalUrl });
    Sentry.captureException(err);
  });
}

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    // Expected 4xx errors are business-as-usual; only report server-side 5xx.
    if (err.statusCode >= 500) {
      captureError(err, req);
    }
    res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        code: err.code,
      },
    });
    return;
  }

  // Client-side HTTP errors thrown by body-parser (truncated JSON → 400
  // entity.parse.failed, body over the limit → 413 entity.too.large). These are
  // the caller's fault: log at warn, skip Sentry, and answer with their status.
  // Only errors that set `expose: true` qualify (http-errors does this for 4xx).
  // Upstream client libraries can also carry a numeric status (404, 401...) but
  // those are server-side faults and must stay a logged 500 with Sentry.
  const errLoose = err as Error & {
    status?: unknown;
    statusCode?: unknown;
    expose?: unknown;
    type?: unknown;
  };
  const httpStatus = errLoose.status ?? errLoose.statusCode;
  // router throws a URIError (status 400, no `expose`) when a :param fails percent-decoding.
  if (
    (errLoose.expose === true || err instanceof URIError) &&
    typeof httpStatus === 'number' &&
    httpStatus >= 400 &&
    httpStatus <= 499
  ) {
    logger.warn('Client request error', {
      status: httpStatus,
      type: errLoose.type,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
    });
    res.status(httpStatus).json({
      success: false,
      error: {
        message: httpStatus === 413 ? 'Request body too large' : 'Malformed request',
        code: ErrorCodes.VALIDATION_ERROR,
      },
    });
    return;
  }

  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
  });

  captureError(err, req);

  res.status(500).json({
    success: false,
    error: {
      message: config.NODE_ENV === 'production' ? 'Internal server error' : err.message,
      code: 'INTERNAL_ERROR',
    },
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      message: `Route ${req.method} ${req.originalUrl} not found`,
      code: 'NOT_FOUND',
    },
  });
}
