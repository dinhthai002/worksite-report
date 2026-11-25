import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { DomainError, type DomainErrorKind, type ErrorDetails, NotFoundError } from "../../domain/errors";
import type { Logger } from "../logger";
import { UnauthenticatedError } from "./actor.middleware";

/** The one error shape every response uses (architecture.md section 4.2, API-03). */
export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: ErrorDetails;
  };
}

export interface ErrorResponse {
  readonly status: number;
  readonly body: ErrorBody;
}

/** The only mapping from domain error kinds to HTTP statuses (ERR-02). */
const STATUS_BY_KIND: Readonly<Record<DomainErrorKind, number>> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RULE_VIOLATION: 422,
};

function errorBody(code: string, message: string, details?: ErrorDetails): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** Errors raised by Express's body parser carry a 4xx `status` and an `expose` flag. */
function isClientHttpError(error: unknown): error is { status: number; type?: unknown } {
  if (typeof error !== "object" || error === null || !("status" in error) || !("expose" in error)) {
    return false;
  }
  return typeof error.status === "number" && error.status >= 400 && error.status < 500 && error.expose === true;
}

export function toErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof DomainError) {
    const details = Object.keys(error.details).length > 0 ? error.details : undefined;
    return { status: STATUS_BY_KIND[error.kind], body: errorBody(error.code, error.message, details) };
  }
  if (error instanceof UnauthenticatedError) {
    return { status: 401, body: errorBody(error.code, error.message) };
  }
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    return { status: 400, body: errorBody("VALIDATION_FAILED", "The request is invalid.", { issues }) };
  }
  if (isClientHttpError(error)) {
    return error.type === "entity.parse.failed"
      ? { status: 400, body: errorBody("MALFORMED_JSON", "The request body is not valid JSON.") }
      : { status: error.status, body: errorBody("INVALID_REQUEST", "The request could not be read.") };
  }
  // ERR-05: unknown errors get a generic message; details go to the log only.
  return { status: 500, body: errorBody("INTERNAL_ERROR", "Something went wrong. Try again later.") };
}

/** Turns any unmatched route into a NOT_FOUND error, so it leaves through the same handler. */
export function routeNotFound(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    next(new NotFoundError("ROUTE_NOT_FOUND", `There is no route for ${req.method} ${req.path}.`));
  };
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const response = toErrorResponse(error);
    if (response.status >= 500) {
      logger.error(
        { err: error, method: req.method, path: req.path, requestId: res.locals.requestId },
        "request failed",
      );
    }
    res.status(response.status).json(response.body);
  };
}
