import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  RuleViolationError,
} from "@src/shared/domain/errors";

describe("DomainError", () => {
  it.each([
    [ForbiddenError, "FORBIDDEN"],
    [NotFoundError, "NOT_FOUND"],
    [ConflictError, "CONFLICT"],
    [RuleViolationError, "RULE_VIOLATION"],
  ] as const)("%p carries the kind %s", (ErrorClass, kind) => {
    const error = new ErrorClass("SOME_CODE", "Something happened.");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.kind).toBe(kind);
  });

  it("keeps the code, message, details, and subclass name", () => {
    const error = new ConflictError("REPORT_VERSION_CONFLICT", "The report has changed.", { currentVersion: 4 });

    expect(error.code).toBe("REPORT_VERSION_CONFLICT");
    expect(error.message).toBe("The report has changed.");
    expect(error.details).toEqual({ currentVersion: 4 });
    expect(error.name).toBe("ConflictError");
  });

  it("defaults details to an empty object", () => {
    const error = new NotFoundError("REPORT_NOT_FOUND", "No such report.");

    expect(error.details).toEqual({});
  });
});
