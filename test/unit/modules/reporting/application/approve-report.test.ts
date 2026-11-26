import { ApproveReport } from "@src/modules/reporting/application/approve-report";
import { type DailyReport, ReportStatus, toReportId } from "@src/modules/reporting/domain/daily-report";
import type { Worksite } from "@src/modules/worksite";
import { type Actor, Role, toUserId } from "@src/shared/domain/actor";
import { toWorksiteId } from "@src/shared/domain/ids";
import { FixedClock } from "../../../../fakes/fixed-clock";
import { InMemoryDailyReportRepository } from "../../../../fakes/in-memory-daily-report.repository";
import { InMemoryWorksiteRepository } from "../../../../fakes/in-memory-worksite.repository";
import { aReport } from "../../../../support/daily-report.builder";
import { aTask, aWorksite } from "../../../../support/worksite.builder";

const LINDA: Actor = { id: toUserId("00000000-0000-4000-8000-000000000001"), role: Role.SITE_SUPERVISOR };
const MARK: Actor = { id: toUserId("00000000-0000-4000-8000-000000000002"), role: Role.FOREMAN };
const HENRY = toUserId("00000000-0000-4000-8000-000000000003");
const TOWNHOUSE = toWorksiteId("00000000-0000-4000-8000-000000000101");
const FOUNDATION = "00000000-0000-4000-8000-000000000201";
const WALLS = "00000000-0000-4000-8000-000000000202";
const ELECTRICAL = "00000000-0000-4000-8000-000000000203";
const NOW = "2026-11-21T03:00:00Z";

function townhouse(): Worksite {
  return aWorksite()
    .withId(TOWNHOUSE)
    .supervisedBy(LINDA.id)
    .withTasks(
      aTask().withId(FOUNDATION).named("Pour foundation").assignedTo(MARK.id).withApprovedProgress(90).build(),
      aTask().withId(WALLS).named("Build ground-floor walls").assignedTo(MARK.id).withApprovedProgress(40).build(),
      aTask().withId(ELECTRICAL).named("Install electrical").assignedTo(HENRY).withApprovedProgress(0).build(),
    )
    .build();
}

function setUp(report: DailyReport): {
  approveReport: ApproveReport;
  reports: InMemoryDailyReportRepository;
  worksites: InMemoryWorksiteRepository;
} {
  const worksites = new InMemoryWorksiteRepository([townhouse()]);
  const reports = new InMemoryDailyReportRepository([report], worksites);
  return { approveReport: new ApproveReport(reports, worksites, new FixedClock(NOW)), reports, worksites };
}

function marksSubmittedReport(): DailyReport {
  return aReport()
    .forWorksite(TOWNHOUSE)
    .by(MARK.id)
    .withItems({ taskId: WALLS, reportedProgress: 55 }, { taskId: FOUNDATION, reportedProgress: 100 })
    .submitted()
    .withVersion(2)
    .build();
}

async function approvedProgress(worksites: InMemoryWorksiteRepository): Promise<Record<string, number>> {
  const worksite = await worksites.findById(TOWNHOUSE);
  return Object.fromEntries((worksite?.tasks ?? []).map((task) => [task.id, task.approvedProgress]));
}

describe("ApproveReport", () => {
  it("approves, increments the version and records the transition at the clock's time", async () => {
    const report = marksSubmittedReport();
    const { approveReport } = setUp(report);

    const view = await approveReport.execute({ actor: LINDA, reportId: report.id, expectedVersion: 2 });

    expect(view.status).toBe(ReportStatus.APPROVED);
    expect(view.version).toBe(3);
    expect(view.transitions.at(-1)).toEqual({
      fromStatus: ReportStatus.SUBMITTED,
      toStatus: ReportStatus.APPROVED,
      actorId: LINDA.id,
      occurredAt: "2026-11-21T03:00:00.000Z",
      reason: null,
    });
  });

  it("BR-9 sets every item's task to its reported progress and leaves other tasks unchanged", async () => {
    const report = marksSubmittedReport();
    const { approveReport, worksites } = setUp(report);

    await approveReport.execute({ actor: LINDA, reportId: report.id, expectedVersion: 2 });

    expect(await approvedProgress(worksites)).toEqual({ [FOUNDATION]: 100, [WALLS]: 55, [ELECTRICAL]: 0 });
  });

  it("refuses an unknown report as REPORT_NOT_FOUND", async () => {
    const { approveReport } = setUp(marksSubmittedReport());
    const unknown = toReportId("00000000-0000-4000-8000-00000000ffff");

    await expect(approveReport.execute({ actor: LINDA, reportId: unknown, expectedVersion: 2 })).rejects.toMatchObject({
      code: "REPORT_NOT_FOUND",
      details: { reportId: unknown },
    });
  });

  it("BR-15 rejects an approval with a stale version, with the current version, and writes nothing", async () => {
    const report = marksSubmittedReport();
    const { approveReport, reports, worksites } = setUp(report);

    await expect(
      approveReport.execute({ actor: LINDA, reportId: report.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "REPORT_VERSION_CONFLICT", details: { expectedVersion: 1, currentVersion: 2 } });
    expect(reports.stored(report.id)).toBe(report);
    expect(await approvedProgress(worksites)).toEqual({ [FOUNDATION]: 90, [WALLS]: 40, [ELECTRICAL]: 0 });
  });

  it("FR-020 checks permission before the version: a foreman with a stale version is refused as not permitted", async () => {
    const report = marksSubmittedReport();
    const { approveReport } = setUp(report);

    await expect(approveReport.execute({ actor: MARK, reportId: report.id, expectedVersion: 1 })).rejects.toMatchObject(
      {
        code: "REPORT_APPROVAL_FORBIDDEN",
      },
    );
  });

  it("FR-020 checks the version before the status: a stale approval of an APPROVED report is a conflict", async () => {
    const report = aReport()
      .forWorksite(TOWNHOUSE)
      .by(MARK.id)
      .withItems({ taskId: WALLS, reportedProgress: 55 })
      .approved()
      .withVersion(3)
      .build();
    const { approveReport } = setUp(report);

    await expect(
      approveReport.execute({ actor: LINDA, reportId: report.id, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: "REPORT_VERSION_CONFLICT", details: { currentVersion: 3 } });
  });

  it("a refused approval leaves the stored report and every task unchanged", async () => {
    const report = aReport()
      .forWorksite(TOWNHOUSE)
      .by(MARK.id)
      .withItems({ taskId: WALLS, reportedProgress: 55 }, { taskId: FOUNDATION, reportedProgress: 80 })
      .submitted()
      .withVersion(2)
      .build();
    const { approveReport, reports, worksites } = setUp(report);

    await expect(
      approveReport.execute({ actor: LINDA, reportId: report.id, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: "REPORT_PROGRESS_OUTDATED" });
    expect(reports.stored(report.id)).toBe(report);
    expect(await approvedProgress(worksites)).toEqual({ [FOUNDATION]: 90, [WALLS]: 40, [ELECTRICAL]: 0 });
  });

  it("fails loudly when the report's worksite is missing", async () => {
    const orphan = aReport().by(MARK.id).submitted().build();
    const approveReport = new ApproveReport(
      new InMemoryDailyReportRepository([orphan]),
      new InMemoryWorksiteRepository(),
      new FixedClock(NOW),
    );

    await expect(approveReport.execute({ actor: LINDA, reportId: orphan.id, expectedVersion: 1 })).rejects.toThrow(
      `Report ${orphan.id} refers to missing worksite ${orphan.worksiteId}`,
    );
  });
});
