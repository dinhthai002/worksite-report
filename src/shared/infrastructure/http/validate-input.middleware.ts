import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

/** No path parameters or query parameters allowed: an unknown key is refused (API-01). */
const NONE = z.strictObject({});
/** No body: nothing sent, or an empty JSON object. */
const NO_BODY = z.union([z.undefined(), z.strictObject({})]);

export interface InputSchemas<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType> {
  readonly params?: P;
  readonly query?: Q;
  readonly body?: B;
}

export interface ValidInput<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType> {
  readonly params: z.output<P>;
  readonly query: z.output<Q>;
  readonly body: z.output<B>;
}

export interface RawInput {
  readonly params: unknown;
  readonly query: unknown;
  readonly body: unknown;
}

export type InputResult<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType> =
  | { readonly success: true; readonly input: ValidInput<P, Q, B> }
  | { readonly success: false; readonly error: z.ZodError };

/**
 * Validates path, query and body together, so issue paths say where the problem is: `params.worksiteId`,
 * `query`, `body` (API-01, research R15). A part without a schema must be empty.
 */
export function parseInput<
  P extends z.ZodType = typeof NONE,
  Q extends z.ZodType = typeof NONE,
  B extends z.ZodType = typeof NO_BODY,
>(schemas: InputSchemas<P, Q, B>, raw: RawInput): InputResult<P, Q, B> {
  const schema = z.object({
    params: schemas.params ?? NONE,
    query: schemas.query ?? NONE,
    body: schemas.body ?? NO_BODY,
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error };
  }
  // A missing schema was replaced by its default above, so the parsed parts have the declared types.
  return { success: true, input: parsed.data as ValidInput<P, Q, B> };
}

/**
 * Wraps a route handler: validates the request with the route's schemas, then calls the handler with typed input.
 * A failure goes to the error handler as a ZodError, which becomes 400 VALIDATION_FAILED.
 * The parsed values are passed to the handler instead of written back to `req`, because Express 5 makes
 * `req.query` read-only.
 */
export function withValidInput<
  P extends z.ZodType = typeof NONE,
  Q extends z.ZodType = typeof NONE,
  B extends z.ZodType = typeof NO_BODY,
>(
  schemas: InputSchemas<P, Q, B>,
  handler: (input: ValidInput<P, Q, B>, res: Response, req: Request) => Promise<void>,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const result = parseInput(schemas, { params: req.params, query: req.query, body: req.body });
    if (!result.success) {
      next(result.error);
      return;
    }
    await handler(result.input, res, req);
  };
}
