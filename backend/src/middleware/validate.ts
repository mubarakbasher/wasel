import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Send a ZodError as the standard 400 VALIDATION_ERROR envelope.
 * Exported so controllers that defer part of a validation decision past the
 * middleware (e.g. auth refresh/logout, where the token may instead arrive in
 * the `wasel_rt` cookie) can emit a byte-identical error response.
 */
export function sendZodValidationError(res: Response, err: ZodError): void {
  const issues = err.issues ?? [];
  res.status(400).json({
    success: false,
    error: {
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: issues.map((e) => ({
        field: e.path.map(String).join('.'),
        message: e.message,
      })),
    },
  });
}

export function validate(schemas: ValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query) as Record<string, unknown>;
        Object.keys(parsed).forEach((key) => {
          (req.query as Record<string, unknown>)[key] = parsed[key];
        });
      }
      if (schemas.params) {
        const parsed = schemas.params.parse(req.params) as Record<string, unknown>;
        Object.keys(parsed).forEach((key) => {
          (req.params as Record<string, unknown>)[key] = parsed[key];
        });
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        sendZodValidationError(res, err);
        return;
      }
      next(err);
    }
  };
}
