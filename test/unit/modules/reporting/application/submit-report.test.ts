import { SubmitReport } from "@src/modules/reporting/application/submit-report";
import { type DailyReport, ReportStatus, toReportId } from "@src/modules/reporting/domain/daily-report";
import type { Worksite } from "@src/modules/worksite";
import { type Actor, Role, toUserId } from "@src/shared/domain/actor";
import { toWorksiteId } from "@src/shared/domain/ids";
import { FixedClock } from "../../../../fakes/fixed-clock";
import { InMemoryDailyReportRepository } from "../../../../fakes/in-memory-daily-report.repository";
import { InMemoryWorksiteRepository } from "../../../../fakes/in-memory-worksite.repository";
import { aReport } from "../../../../support/daily-report.builder";
import { aTask, aWorksite } from "../../../../support/worksite.builder";

const MARK: Actor = { id: toUserId("00000000-0000-4000-8000-000000000002"), role: Role.FOREMAN };
const TOWNHOUSE = toWorksiteId("00000000-0000-4000-8000-000000000101");
const WALLS = "00000000-0000-4000-8000-000000000202";
const NOW = "2026-11-20T10:05:00Z";

function townhouse(): Worksite {
  return aWorksite()
    .withId(TOWNHOUSE)
    .withTasks(aTask().withId(WALLS).assignedTo(MARK.id).withApprovedProgress(40).build())
    .build();
}

function setUp(report: DailyReport): {
  submitReport: SubmitReport;
  reports: InMemoryDailyReportRepository;
  worksites: InMemoryWorksiteRepository;
} {
  const reports = new InMemoryDailyReportRepository([report]);
  const worksites = new InMemoryWorksiteRepository([townhouse()]);
  return { submitReport: new SubmitReport(reports, worksites, new FixedClock(NOW)), reports, worksites };
}

function marksDraft(): DailyReport {
  return aReport().forWorksite(TOWNHOUSE).by(MARK.id).withItems({ taskId: WALLS, reportedProgress: 55 }).build();
}

describe("SubmitReport", () => {
  it("submits, increments the version and records the transition at the clock's time", async () => {
    const draft = marksDraft();
    const { submitReport } = setUp(draft);

    const view = await submitReport.execute({ actor: MARK, reportId: draft.id, expectedVersion: 1 });

    expect(view).toEqual(
      expect.objectContaining({
        status: ReportStatus.SUBMITTED,
        version: 2,
        transitions: [
          {
            fromStatus: "DRAFT",
            toStatus: "SUBMITTED",
            actorId: MARK.id,
            occurredAt: "2026-11-20T10:05:00.000Z",
            reason: null,
          },
        ],
      }),
    );
  });

  it("BR-15 rejects a submission with a stale version", async () => {
    const draft = aReport()
      .forWorksite(TOWNHOUSE)
      .by(MARK.id)
      .withVersion(3)
      .withItems({ taskId: WALLS, reportedProgress: 55 })
      .build();
    const { submitReport } = setUp(draft);

    await expect(submitReport.execute({ actor: MARK, reportId: draft.id, expectedVersion: 2 })).rejects.toThrow(
      expect.objectContaining({ code: "REPORT_VERSION_CONFLICT", details: { expectedVersion: 2, currentVersion: 3 } }),
    );
  });

  it("refuses an unknown report with REPORT_NOT_FOUND", async () => {
    const { submitReport } = setUp(marksDraft());
    const unknown = toReportId("00000000-0000-4000-8000-000000000999");

    await expect(submitReport.execute({ actor: MARK, reportId: unknown, expectedVersion: 1 })).rejects.toThrow(
      expect.objectContaining({ code: "REPORT_NOT_FOUND", details: { reportId: unknown } }),
    );
  });

  it("leaves every task's approved progress unchanged", async () => {
    const draft = marksDraft();
    const { submitReport, worksites } = setUp(draft);

    await submitReport.execute({ actor: MARK, reportId: draft.id, expectedVersion: 1 });

    const worksite = await worksites.findById(TOWNHOUSE);
    expect(worksite?.tasks.map((task) => task.approvedProgress)).toEqual([40]);
  });

  it("a refused submission leaves the stored report unchanged", async () => {
    const draft = aReport()
      .forWorksite(TOWNHOUSE)
      .by(MARK.id)
      .withItems({ taskId: WALLS, reportedProgress: 30 })
      .build();
    const { submitReport, reports } = setUp(draft);

    await expect(submitReport.execute({ actor: MARK, reportId: draft.id, expectedVersion: 1 })).rejects.toThrow(
      expect.objectContaining({ code: "PROGRESS_BELOW_APPROVED" }),
    );
    expect(reports.stored(draft.id)).toBe(draft);
  });

  it("fails loudly when the report's worksite is missing, which the foreign key rules out", async () => {
    const draft = marksDraft();
    const reports = new InMemoryDailyReportRepository([draft]);
    const submitReport = new SubmitReport(reports, new InMemoryWorksiteRepository([]), new FixedClock(NOW));

    await expect(submitReport.execute({ actor: MARK, reportId: draft.id, expectedVersion: 1 })).rejects.toThrow(
      `Report ${draft.id} refers to missing worksite ${TOWNHOUSE}`,
    );
  });
});
