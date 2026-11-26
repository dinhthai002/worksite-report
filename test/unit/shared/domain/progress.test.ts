import { isProgress, toProgress } from "@src/shared/domain/progress";

describe("Progress", () => {
  it.each([0, 40, 100])("accepts %p", (value) => {
    expect(isProgress(value)).toBe(true);
  });

  it.each([-1, 101, 55.5, Number.NaN])("rejects %p", (value) => {
    expect(isProgress(value)).toBe(false);
  });

  it("toProgress returns a valid value unchanged", () => {
    expect(toProgress(55)).toBe(55);
  });

  it("toProgress throws a RangeError naming an invalid value", () => {
    expect(() => toProgress(101)).toThrow(new RangeError("Progress must be an integer from 0 to 100, got 101."));
  });
});
