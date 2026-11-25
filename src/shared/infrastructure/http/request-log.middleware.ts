import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Logger } from "../logger";

declare global {
  namespace Express {
    interface Locals {
      requestId?: string;
    }
  }
}

export const REQUEST_ID_HEADER = "x-request-id";

const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Reuses the caller's X-Request-Id when it is safe to log, otherwise generates one. */
export function resolveRequestId(header: string | undefined): string {
  return header !== undefined && SAFE_REQUEST_ID.test(header) ? header : randomUUID();
}

/** LOG-02: one line per request with method, path, status, duration, actor ID, and request ID. */
export function requestLogMiddleware(logger: Logger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint();
    const requestId = resolveRequestId(req.get(REQUEST_ID_HEADER));
    res.locals.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    res.on("finish", () => {
      logger.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
          actorId: res.locals.actor?.id,
          requestId,
        },
        "request completed",
      );
    });
    next();
  };
}
