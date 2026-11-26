import { ReportItem } from "@src/modules/reporting/domain/report-item";
import { RuleViolationError } from "@src/shared/domain/errors";
import { toTaskId } from "@src/shared/domain/ids";

const WALLS = toTaskId("00000000-0000-4000-8000-000000000202");

describe("ReportItem", () => {
  it.each([-1, 101])("BR-5 rejects reported progress %i, naming the task", (reportedProgress) => {
    const create = (): ReportItem => ReportItem.create(WALLS, reportedProgress, null);

    expect(create).toThrow(RuleViolationError);
    expect(create).toThrow(
      expect.objectContaining({
        code: "PROGRESS_OUT_OF_RANGE",
        details: { taskId: WALLS, reportedProgress, min: 0, max: 100 },
      }),
    );
  });

  it("BR-5 rejects reported progress that is not a whole number", () => {
    expect(() => ReportItem.create(WALLS, 55.5, null)).toThrow(RuleViolationError);
  });

  it.each([0, 100])("BR-5 accepts reported progress %i", (reportedProgress) => {
    const item = ReportItem.create(WALLS, reportedProgress, "Walls up to lintel height.");

    expect(item).toEqual(
      expect.objectContaining({ taskId: WALLS, reportedProgress, note: "Walls up to lintel height." }),
    );
  });
});
