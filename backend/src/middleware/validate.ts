import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
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
        return;
      }
      next(err);
    }
  };
}
