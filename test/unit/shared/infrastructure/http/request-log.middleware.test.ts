import { resolveRequestId } from "@src/shared/infrastructure/http/request-log.middleware";

describe("resolveRequestId", () => {
  it("reuses a well-formed request ID from the caller", () => {
    expect(resolveRequestId("req-42-abc")).toBe("req-42-abc");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["containing unsafe characters", "abc\ninjected log line"],
    ["longer than 64 characters", "a".repeat(65)],
  ])("generates a UUID when the caller's ID is %s", (_case, header) => {
    expect(resolveRequestId(header)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
