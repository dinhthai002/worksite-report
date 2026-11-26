import { parseInput } from "@src/shared/infrastructure/http/validate-input.middleware";
import { z } from "zod";

const params = z.object({ worksiteId: z.uuid() });
const WORKSITE_ID = "00000000-0000-4000-8000-000000000101";

function issuePaths(result: ReturnType<typeof parseInput>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("parseInput (API-01)", () => {
  it("returns typed params, query and body", () => {
    const result = parseInput(
      { params, query: z.object({ page: z.coerce.number() }), body: z.object({ version: z.number() }) },
      { params: { worksiteId: WORKSITE_ID }, query: { page: "2" }, body: { version: 3 } },
    );

    expect(result).toEqual({
      success: true,
      input: { params: { worksiteId: WORKSITE_ID }, query: { page: 2 }, body: { version: 3 } },
    });
  });

  it("refuses a bad path parameter with the path params.<name>", () => {
    const result = parseInput({ params }, { params: { worksiteId: "not-a-uuid" }, query: {}, body: undefined });

    expect(issuePaths(result)).toEqual(["params.worksiteId"]);
  });

  it("refuses a query parameter when the route declares none, naming the key", () => {
    const result = parseInput(
      { params },
      { params: { worksiteId: WORKSITE_ID }, query: { foo: "1" }, body: undefined },
    );

    expect(issuePaths(result)).toEqual(["query"]);
    expect(result.success ? "" : (result.error.issues[0]?.message ?? "")).toContain("foo");
  });

  it("refuses a body when the route declares none", () => {
    const result = parseInput(
      { params },
      { params: { worksiteId: WORKSITE_ID }, query: {}, body: { approvedProgress: 100 } },
    );

    expect(issuePaths(result)).toEqual(["body"]);
  });

  it.each([
    ["absent", undefined],
    ["an empty object", {}],
  ])("accepts a body that is %s when the route declares none", (_case, body) => {
    const result = parseInput({ params }, { params: { worksiteId: WORKSITE_ID }, query: {}, body });

    expect(result.success).toBe(true);
  });

  it("refuses path parameters when the route declares none", () => {
    const result = parseInput({}, { params: { extra: "x" }, query: {}, body: undefined });

    expect(issuePaths(result)).toEqual(["params"]);
  });
});
