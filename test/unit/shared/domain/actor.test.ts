import { isRole, toUserId } from "@src/shared/domain/actor";

describe("isRole", () => {
  it.each(["FOREMAN", "SITE_SUPERVISOR"])("accepts %s", (value) => {
    expect(isRole(value)).toBe(true);
  });

  it.each(["foreman", "ADMIN", ""])("rejects %p", (value) => {
    expect(isRole(value)).toBe(false);
  });
});

describe("toUserId", () => {
  it("keeps the value unchanged", () => {
    expect(toUserId("7f8c1a52-3a4e-4a0e-9d55-0d8f9f6a2b11")).toBe("7f8c1a52-3a4e-4a0e-9d55-0d8f9f6a2b11");
  });
});
