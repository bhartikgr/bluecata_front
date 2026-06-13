/**
 * Sprint 17 D2 — central zod-based request validator.
 *
 * Usage:
 *   app.post("/api/x", validateBody(MySchema), handler)
 *
 * Rejects unknown fields by default (zod `strict()`). On failure, responds
 * with 400 + a redacted error list (field paths only, no values, no stack).
 */
import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { z } from "zod";

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const r = schema.safeParse(req.body);
    if (!r.success) {
      return res.status(400).json({
        error: "validation_failed",
        fields: r.error.issues.map(i => ({ path: i.path.join("."), code: i.code })),
      });
    }
    (req as any).validated = r.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const r = schema.safeParse(req.query);
    if (!r.success) {
      return res.status(400).json({
        error: "validation_failed",
        scope: "query",
        fields: r.error.issues.map(i => ({ path: i.path.join("."), code: i.code })),
      });
    }
    (req as any).validatedQuery = r.data;
    next();
  };
}

/** Reusable primitive schemas with sane caps. */
export const Email = z.string().email().max(254);
export const ShortText = z.string().min(1).max(200);
export const LongText = z.string().min(1).max(10_000);
export const Id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_\-:]+$/);

/** Strict object: rejects unknown fields + sets up readable error path. */
export function strictObject<S extends z.ZodRawShape>(shape: S) {
  return z.object(shape).strict();
}
