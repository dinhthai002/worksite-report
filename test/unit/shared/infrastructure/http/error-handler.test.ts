import { ConflictError, ForbiddenError, NotFoundError, RuleViolationError } from "@src/shared/domain/errors";
import { UnauthenticatedError } from "@src/shared/infrastructure/http/actor.middleware";
import { toErrorResponse } from "@src/shared/infrastructure/http/error-handler";
import { z } from "zod";

describe("toErrorResponse", () => {
  it.each([
    [new ForbiddenError("NOT_SUPERVISOR", "Not allowed."), 403],
    [new NotFoundError("REPORT_NOT_FOUND", "No such report."), 404],
    [new ConflictError("REPORT_VERSION_CONFLICT", "Stale copy."), 409],
    [new RuleViolationError("PROGRESS_BELOW_APPROVED", "Too low."), 422],
  ])("maps %p to status %i", (error, status) => {
    expect(toErrorResponse(error).status).toBe(status);
  });

  it("returns the code, message, and details of a domain error", () => {
    const error = new ConflictError("REPORT_VERSION_CONFLICT", "The report has changed. Reload and try again.", {
      currentVersion: 4,
    });

    expect(toErrorResponse(error).body).toEqual({
      error: {
        code: "REPORT_VERSION_CONFLICT",
        message: "The report has changed. Reload and try again.",
        details: { currentVersion: 4 },
      },
    });
  });

  it("omits details when a domain error has none", () => {
    expect(toErrorResponse(new NotFoundError("REPORT_NOT_FOUND", "No such report.")).body).toEqual({
      error: { code: "REPORT_NOT_FOUND", message: "No such report." },
    });
  });

  it("maps a missing or invalid actor to 401", () => {
    const response = toErrorResponse(new UnauthenticatedError("Send the actor headers."));

    expect(response).toEqual({
      status: 401,
      body: { error: { code: "UNAUTHENTICATED", message: "Send the actor headers." } },
    });
  });

  it("maps a schema validation failure to 400 with the failing fields", () => {
    const result = z.object({ version: z.number() }).safeParse({ version: "4" });
    if (result.success) {
      throw new Error("expected the schema to reject the input");
    }

    const response = toErrorResponse(result.error);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details).toEqual({
      issues: [{ path: "version", message: expect.any(String) }],
    });
  });

  it("maps a malformed JSON body to 400", () => {
    const parseError = Object.assign(new SyntaxError("Unexpected token"), {
      status: 400,
      expose: true,
      type: "entity.parse.failed",
    });

    expect(toErrorResponse(parseError)).toEqual({
      status: 400,
      body: { error: { code: "MALFORMED_JSON", message: "The request body is not valid JSON." } },
    });
  });

  it("keeps the status of other client errors raised while reading the request", () => {
    const tooLarge = Object.assign(new Error("request entity too large"), {
      status: 413,
      expose: true,
      type: "entity.too.large",
    });

    expect(toErrorResponse(tooLarge)).toEqual({
      status: 413,
      body: { error: { code: "INVALID_REQUEST", message: "The request could not be read." } },
    });
  });

  it("ERR-05 hides the details of an unknown error behind a generic 500", () => {
    const response = toErrorResponse(new Error("connection refused at 10.0.0.5:5432"));

    expect(response).toEqual({
      status: 500,
      body: { error: { code: "INTERNAL_ERROR", message: "Something went wrong. Try again later." } },
    });
  });
});
