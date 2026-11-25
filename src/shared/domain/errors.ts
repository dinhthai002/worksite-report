/**
 * Errors thrown by domain and application code (ERR-01). Each kind names what went wrong, not an HTTP status;
 * error-handler.ts is the one place that maps kinds to statuses (ERR-02).
 */
export type DomainErrorKind = "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "RULE_VIOLATION";

export type ErrorDetails = Readonly<Record<string, unknown>>;

export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;

  /** Stable, UPPER_SNAKE_CASE code that clients can rely on (NAM-07). */
  readonly code: string;
  readonly details: ErrorDetails;

  constructor(code: string, message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** The actor is not allowed to perform the action. */
export class ForbiddenError extends DomainError {
  override readonly kind = "FORBIDDEN";
}

/** The resource does not exist. */
export class NotFoundError extends DomainError {
  override readonly kind = "NOT_FOUND";
}

/** The caller's copy is stale, or the current status does not allow the action. */
export class ConflictError extends DomainError {
  override readonly kind = "CONFLICT";
}

/** A business rule is violated. */
export class RuleViolationError extends DomainError {
  override readonly kind = "RULE_VIOLATION";
}
