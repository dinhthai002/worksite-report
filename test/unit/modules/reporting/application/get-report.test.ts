import { GetReport } from "@src/modules/reporting/application/get-report";
import { type DailyReport, ReportStatus, toReportId } from "@src/modules/reporting/domain/daily-report";
import { type Actor, Role, toUserId } from "@src/shared/domain/actor";
import { toWorksiteId } from "@src/shared/domain/ids";
import { InMemoryDailyReportRepository } from "../../../../fakes/in-memory-daily-report.repository";
import { InMemoryWorksiteRepository } from "../../../../fakes/in-memory-worksite.repository";
import { aReport } from "../../../../support/daily-report.builder";
import { aTask, aWorksite } from "../../../../support/worksite.builder";

const MARK: Actor = { id: toUserId("00000000-0000-4000-8000-000000000002"), role: Role.FOREMAN };
const LINDA: Actor = { id: toUserId("00000000-0000-4000-8000-000000000001"), role: Role.SITE_SUPERVISOR };
const TOWNHOUSE = toWorksiteId("00000000-0000-4000-8000-000000000101");
const WALLS = "00000000-0000-4000-8000-000000000202";
const FOUNDATION = "00000000-0000-4000-8000-000000000201";

function getReportWith(report: DailyReport): GetReport {
  const worksite = aWorksite()
    .withId(TOWNHOUSE)
    .supervisedBy(LINDA.id)
    .withTasks(
      aTask().withId(FOUNDATION).assignedTo(MARK.id).withApprovedProgress(100).build(),
      aTask().withId(WALLS).assignedTo(MARK.id).withApprovedProgress(40).build(),
    )
    .build();
  return new GetReport(new InMemoryDailyReportRepository([report]), new InMemoryWorksiteRepository([worksite]));
}

describe("GetReport", () => {
  it("returns the report with its items and its transitions in order", async () => {
    const report = aReport()
      .forWorksite(TOWNHOUSE)
      .by(MARK.id)
      .withItems({ taskId: WALLS, reportedProgress: 55 }, { taskId: FOUNDATION, reportedProgress: 100 })
      .rejected()
      .build();

    const view = await getReportWith(report).execute({ actor: MARK, reportId: report.id });

    expect(view.id).toBe(report.id);
    expect(view.status).toBe(ReportStatus.REJECTED);
    expect(view.items.map((item) => item.taskId)).toEqual([WALLS, FOUNDATION]);
    expect(view.transitions.map((transition) => transition.toStatus)).toEqual([
      ReportStatus.SUBMITTED,
      ReportStatus.REJECTED,
    ]);
  });

  it("refuses an unknown report as REPORT_NOT_FOUND", async () => {
    const getReport = getReportWith(aReport().forWorksite(TOWNHOUSE).by(MARK.id).build());
    const unknown = toReportId("00000000-0000-4000-8000-00000000ffff");

    await expect(getReport.execute({ actor: MARK, reportId: unknown })).rejects.toMatchObject({
      code: "REPORT_NOT_FOUND",
      details: { reportId: unknown },
    });
  });

  it("FR-030 refuses the worksite's site supervisor a draft as REPORT_VIEW_FORBIDDEN", async () => {
    const draft = aReport().forWorksite(TOWNHOUSE).by(MARK.id).build();

    await expect(getReportWith(draft).execute({ actor: LINDA, reportId: draft.id })).rejects.toMatchObject({
      code: "REPORT_VIEW_FORBIDDEN",
    });
  });

  it("writes nothing: the stored report is the same object after viewing", async () => {
    const report = aReport().forWorksite(TOWNHOUSE).by(MARK.id).submitted().build();
    const reports = new InMemoryDailyReportRepository([report]);
    const getReport = new GetReport(
      reports,
      new InMemoryWorksiteRepository([aWorksite().withId(TOWNHOUSE).supervisedBy(LINDA.id).build()]),
    );

    await getReport.execute({ actor: LINDA, reportId: report.id });

    expect(reports.stored(report.id)).toBe(report);
  });

  it("fails loudly when the report's worksite is missing", async () => {
    const orphan = aReport().by(MARK.id).build();
    const getReport = new GetReport(new InMemoryDailyReportRepository([orphan]), new InMemoryWorksiteRepository());

    await expect(getReport.execute({ actor: MARK, reportId: orphan.id })).rejects.toThrow(
      `Report ${orphan.id} refers to missing worksite ${orphan.worksiteId}`,
    );
  });
});
