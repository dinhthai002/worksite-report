import { assertNever } from "@src/shared/domain/assert-never";

describe("assertNever", () => {
  it("throws an error naming the unexpected value", () => {
    expect(() => assertNever("ADMIN" as never)).toThrow("Unexpected value: ADMIN");
  });
});
