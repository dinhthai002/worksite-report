import { calendarDateIn } from "@src/shared/infrastructure/system-clock";

describe("calendarDateIn", () => {
  // Asia/Ho_Chi_Minh is UTC+7, so the local day starts at 17:00 UTC the day before.
  it("returns the local date just before midnight in the configured zone", () => {
    expect(calendarDateIn(new Date("2026-11-20T16:59:59Z"), "Asia/Ho_Chi_Minh")).toBe("2026-11-20");
  });

  it("rolls over to the next local date at midnight in the configured zone", () => {
    expect(calendarDateIn(new Date("2026-11-20T17:00:00Z"), "Asia/Ho_Chi_Minh")).toBe("2026-11-21");
  });

  it("gives different dates for the same instant in different zones", () => {
    const instant = new Date("2026-11-20T20:00:00Z");

    expect(calendarDateIn(instant, "Asia/Ho_Chi_Minh")).toBe("2026-11-21");
    expect(calendarDateIn(instant, "America/New_York")).toBe("2026-11-20");
  });
});
