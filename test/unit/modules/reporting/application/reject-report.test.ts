import { RejectReport } from "@src/modules/reporting/application/reject-report";
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
const MARK = toUserId("00000000-0000-4000-8000-000000000002");
const HENRY: Actor = { id: toUserId("00000000-0000-4000-8000-000000000003"), role: Role.FOREMAN };
const TOWNHOUSE = toWorksiteId("00000000-0000-4000-8000-000000000101");
const WALLS = "00000000-0000-4000-8000-000000000202";
const ELECTRICAL = "00000000-0000-4000-8000-000000000203";
const NOW = "2026-11-21T03:00:00Z";
const REASON = "conduit laid, no wiring pulled yet";

function townhouse(): Worksite {
  return aWorksite()
    .withId(TOWNHOUSE)
    .supervisedBy(LINDA.id)
    .withTasks(
      aTask().withId(WALLS).named("Build ground-floor walls").assignedTo(MARK).withApprovedProgress(40).build(),
      aTask().withId(ELECTRICAL).named("Install electrical").assignedTo(HENRY.id).withApprovedProgress(0).build(),
    )
    .build();
}

function setUp(report: DailyReport): {
  rejectReport: RejectReport;
  reports: InMemoryDailyReportRepository;
  worksites: InMemoryWorksiteRepository;
} {
  const worksites = new InMemoryWorksiteRepository([townhouse()]);
  const reports = new InMemoryDailyReportRepository([report], worksites);
  return { rejectReport: new RejectReport(reports, worksites, new FixedClock(NOW)), reports, worksites };
}

function henrysSubmittedReport(): DailyReport {
  return aReport()
    .forWorksite(TOWNHOUSE)
    .by(HENRY.id)
    .withItems({ taskId: ELECTRICAL, reportedProgress: 10 })
    .submitted()
    .withVersion(2)
    .build();
}

describe("RejectReport", () => {
  it("rejects, increments the version and records the transition with the reason at the clock's time", async () => {
    const report = henrysSubmittedReport();
    const { rejectReport } = setUp(report);

    const view = await rejectReport.execute({ actor: LINDA, reportId: report.id, expectedVersion: 2, reason: REASON });

    expect(view.status).toBe(ReportStatus.REJECTED);
    expect(view.version).toBe(3);
    expect(view.transitions.at(-1)).toEqual({
      fromStatus: ReportStatus.SUBMITTED,
      toStatus: ReportStatus.REJECTED,
      actorId: LINDA.id,
      occurredAt: "2026-11-21T03:00:00.000Z",
      reason: REASON,
    });
  });

  it("FR-006 changes no task", async () => {
    const report = henrysSubmittedReport();
    const { rejectReport, worksites } = setUp(report);
    const before = await worksites.findById(TOWNHOUSE);

    await rejectReport.execute({ actor: LINDA, reportId: report.id, expectedVersion: 2, reason: REASON });

    expect(await worksites.findById(TOWNHOUSE)).toEqual(before);
  });

  it("refuses an unknown report as REPORT_NOT_FOUND", async () => {
    const { rejectReport } = setUp(henrysSubmittedReport());
    const unknown = toReportId("00000000-0000-4000-8000-00000000ffff");

    await expect(
      rejectReport.execute({ actor: LINDA, reportId: unknown, expectedVersion: 2, reason: REASON }),
    ).rejects.toMatchObject({ code: "REPORT_NOT_FOUND", details: { reportId: unknown } });
  });

  it("BR-15 rejects a rejection with a stale version, with the current version, and writes nothing", async () => {
    const report = henrysSubmittedReport();
    const { rejectReport, reports } = setUp(report);

    await expect(
      rejectReport.execute({ actor: LINDA, reportId: report.id, expectedVersion: 1, reason: REASON }),
    ).rejects.toMatchObject({ code: "REPORT_VERSION_CONFLICT", details: { expectedVersion: 1, currentVersion: 2 } });
    expect(reports.stored(report.id)).toBe(report);
  });

  it("FR-021 checks permission before the version: a foreman with a stale version is refused as not permitted", async () => {
    const report = henrysSubmittedReport();
    const { rejectReport } = setUp(report);

    await expect(
      rejectReport.execute({ actor: HENRY, reportId: report.id, expectedVersion: 1, reason: REASON }),
    ).rejects.toMatchObject({ code: "REPORT_REJECTION_FORBIDDEN" });
  });

  it("FR-021 checks the version before the status: a stale rejection of an APPROVED report is a conflict", async () => {
    const report = aReport()
      .forWorksite(TOWNHOUSE)
      .by(HENRY.id)
      .withItems({ taskId: ELECTRICAL, reportedProgress: 10 })
      .approved()
      .withVersion(3)
      .build();
    const { rejectReport } = setUp(report);

    await expect(
      rejectReport.execute({ actor: LINDA, reportId: report.id, expectedVersion: 2, reason: REASON }),
    ).rejects.toMatchObject({ code: "REPORT_VERSION_CONFLICT", details: { currentVersion: 3 } });
  });

  it("FR-021 checks the status before the reason: an APPROVED report with no reason states the status", async () => {
    const report = aReport()
      .forWorksite(TOWNHOUSE)
      .by(HENRY.id)
      .withItems({ taskId: ELECTRICAL, reportedProgress: 10 })
      .approved()
      .withVersion(3)
      .build();
    const { rejectReport } = setUp(report);

    await expect(
      rejectReport.execute({ actor: LINDA, reportId: report.id, expectedVersion: 3, reason: null }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION", details: { from: "APPROVED", to: "REJECTED" } });
  });

  it("BR-8 a rejection without a reason leaves the stored report unchanged", async () => {
    const report = henrysSubmittedReport();
    const { rejectReport, reports } = setUp(report);

    await expect(
      rejectReport.execute({ actor: LINDA, reportId: report.id, expectedVersion: 2, reason: null }),
    ).rejects.toMatchObject({ code: "REJECTION_REASON_REQUIRED" });
    expect(reports.stored(report.id)).toBe(report);
  });

  it("fails loudly when the report's worksite is missing", async () => {
    const orphan = aReport().by(HENRY.id).submitted().build();
    const rejectReport = new RejectReport(
      new InMemoryDailyReportRepository([orphan]),
      new InMemoryWorksiteRepository(),
      new FixedClock(NOW),
    );

    await expect(
      rejectReport.execute({ actor: LINDA, reportId: orphan.id, expectedVersion: 1, reason: REASON }),
    ).rejects.toThrow(`Report ${orphan.id} refers to missing worksite ${orphan.worksiteId}`);
  });
});
