import {
  DailyReport,
  type DailyReportProps,
  ReportStatus,
  toReportId,
  toWorkDate,
} from "@src/modules/reporting/domain/daily-report";
import { ReportItem } from "@src/modules/reporting/domain/report-item";
import { PrismaDailyReportRepository } from "@src/modules/reporting/infrastructure/prisma-daily-report.repository";
import { toUserId } from "@src/shared/domain/actor";
import { ConflictError } from "@src/shared/domain/errors";
import { toTaskId, toWorksiteId } from "@src/shared/domain/ids";
import { toProgress } from "@src/shared/domain/progress";
import { createPrismaClient } from "@src/shared/infrastructure/db";
import { aReport } from "../support/daily-report.builder";
import {
  insertReport,
  insertReportItem,
  insertTask,
  insertTransition,
  insertUser,
  insertWorksite,
  truncateAll,
} from "../support/database";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is not set. Integration tests must run through Jest, which starts PostgreSQL.");
}

const LONG_AGO = new Date("2000-01-01T00:00:00Z");
const A_LITTLE_LATER = new Date("2000-01-02T00:00:00Z");

function changed(report: DailyReport, changes: Partial<DailyReportProps>): DailyReport {
  return DailyReport.restore({
    id: report.id,
    worksiteId: report.worksiteId,
    authorId: report.authorId,
    workDate: report.workDate,
    status: report.status,
    version: report.version,
    note: report.note,
    items: report.items,
    transitions: report.transitions,
    ...changes,
  });
}

function item(taskId: string, reportedProgress: number, note: string | null = null): ReportItem {
  return ReportItem.restore({ taskId: toTaskId(taskId), reportedProgress: toProgress(reportedProgress), note });
}

describe("PrismaDailyReportRepository", () => {
  const prisma = createPrismaClient(databaseUrl);
  const reports = new PrismaDailyReportRepository(prisma);

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function aForemanWithTwoTasks(): Promise<{ worksiteId: string; authorId: string; taskIds: string[] }> {
    const worksite = await insertWorksite(prisma);
    const author = await insertUser(prisma);
    const first = await insertTask(prisma, { worksiteId: worksite.id, assigneeId: author.id });
    const second = await insertTask(prisma, { worksiteId: worksite.id, assigneeId: author.id });
    return { worksiteId: worksite.id, authorId: author.id, taskIds: [first.id, second.id].sort() };
  }

  it("round trip: a report with items and a transition loads back equal", async () => {
    const { worksiteId, authorId, taskIds } = await aForemanWithTwoTasks();
    const [first = "", second = ""] = taskIds;
    const draft = aReport()
      .forWorksite(toWorksiteId(worksiteId))
      .by(toUserId(authorId))
      .withNote("Rain from 15:00.")
      .withItems({ taskId: first, reportedProgress: 55 }, { taskId: second, reportedProgress: 10, note: "Started" })
      .build();
    const added = await reports.add(draft);
    const submitted = changed(added.report, {
      status: ReportStatus.SUBMITTED,
      transitions: [
        {
          from: ReportStatus.DRAFT,
          to: ReportStatus.SUBMITTED,
          actorId: toUserId(authorId),
          occurredAt: new Date("2026-11-20T10:05:12.345Z"),
          reason: null,
        },
      ],
    });

    await reports.save(submitted, 1);

    expect(added.created).toBe(true);
    expect(await reports.findById(draft.id)).toEqual(changed(submitted, { version: 2 }));
  });

  it("BR-1 add returns the existing report with created false when the foreman already has one for the worksite and date", async () => {
    const { worksiteId, authorId, taskIds } = await aForemanWithTwoTasks();
    const [first = ""] = taskIds;
    const original = aReport()
      .forWorksite(toWorksiteId(worksiteId))
      .by(toUserId(authorId))
      .withItems({ taskId: first, reportedProgress: 55 })
      .build();
    await reports.add(original);
    const second = aReport()
      .forWorksite(toWorksiteId(worksiteId))
      .by(toUserId(authorId))
      .withItems({ taskId: first, reportedProgress: 99 })
      .build();

    const result = await reports.add(second);

    expect(result.created).toBe(false);
    expect(result.report.id).toBe(original.id);
    expect(result.report.items.map((i) => i.reportedProgress)).toEqual([55]);
    expect(await reports.findById(second.id)).toBeUndefined();
  });

  it("BR-15 a save with a stale version updates zero rows, raises REPORT_VERSION_CONFLICT with the current version, and leaves items unchanged", async () => {
    const { worksiteId, authorId, taskIds } = await aForemanWithTwoTasks();
    const [first = ""] = taskIds;
    const { report } = await reports.add(
      aReport()
        .forWorksite(toWorksiteId(worksiteId))
        .by(toUserId(authorId))
        .withItems({ taskId: first, reportedProgress: 55 })
        .build(),
    );
    await reports.save(changed(report, { note: "first writer" }), 1);

    const stale = reports.save(changed(report, { note: "second writer", items: [item(first, 60)] }), 1);

    await expect(stale).rejects.toThrow(ConflictError);
    await expect(stale).rejects.toThrow(
      expect.objectContaining({
        code: "REPORT_VERSION_CONFLICT",
        details: { expectedVersion: 1, currentVersion: 2 },
      }),
    );
    const stored = await reports.findById(report.id);
    expect(stored?.note).toBe("first writer");
    expect(stored?.items.map((i) => i.reportedProgress)).toEqual([55]);
  });

  it("save increments the version by 1 and returns the stored report", async () => {
    const { worksiteId, authorId } = await aForemanWithTwoTasks();
    const { report } = await reports.add(
      aReport().forWorksite(toWorksiteId(worksiteId)).by(toUserId(authorId)).build(),
    );

    const saved = await reports.save(changed(report, { note: "changed" }), 1);

    expect(saved.version).toBe(2);
    expect(saved.note).toBe("changed");
  });

  it("writes only the items that changed, removes the ones left out, and lists the changed one first", async () => {
    const worksite = await insertWorksite(prisma);
    const author = await insertUser(prisma);
    const kept = await insertTask(prisma, { worksiteId: worksite.id, assigneeId: author.id });
    const edited = await insertTask(prisma, { worksiteId: worksite.id, assigneeId: author.id });
    const removed = await insertTask(prisma, { worksiteId: worksite.id, assigneeId: author.id });
    const row = await insertReport(prisma, { worksiteId: worksite.id, authorId: author.id });
    await insertReportItem(prisma, {
      reportId: row.id,
      taskId: kept.id,
      reportedProgress: 10,
      createdAt: LONG_AGO,
      updatedAt: A_LITTLE_LATER,
    });
    await insertReportItem(prisma, {
      reportId: row.id,
      taskId: edited.id,
      reportedProgress: 20,
      createdAt: LONG_AGO,
      updatedAt: LONG_AGO,
    });
    await insertReportItem(prisma, {
      reportId: row.id,
      taskId: removed.id,
      reportedProgress: 30,
      createdAt: LONG_AGO,
      updatedAt: LONG_AGO,
    });
    const loaded = await reports.findById(toReportId(row.id));
    if (loaded === undefined) {
      throw new Error("report not found");
    }

    const saved = await reports.save(changed(loaded, { items: [item(kept.id, 10), item(edited.id, 25)] }), 1);

    expect(saved.items.map((i) => [i.taskId, i.reportedProgress])).toEqual([
      [edited.id, 25],
      [kept.id, 10],
    ]);
    const keptRow = await prisma.reportItem.findUniqueOrThrow({
      where: { reportTask: { reportId: row.id, taskId: kept.id } },
    });
    expect(keptRow.updatedAt).toEqual(A_LITTLE_LATER);
  });

  it("loads transitions oldest first", async () => {
    const report = await insertReport(prisma, { status: "SUBMITTED", version: 4 });
    await insertTransition(prisma, {
      reportId: report.id,
      actorId: report.authorId,
      fromStatus: "REJECTED",
      toStatus: "SUBMITTED",
      occurredAt: new Date("2026-11-21T02:00:00Z"),
    });
    await insertTransition(prisma, {
      reportId: report.id,
      actorId: report.authorId,
      fromStatus: "DRAFT",
      toStatus: "SUBMITTED",
      occurredAt: new Date("2026-11-20T10:00:00Z"),
    });

    const loaded = await reports.findById(toReportId(report.id));

    expect(loaded?.transitions.map((t) => t.from)).toEqual(["DRAFT", "REJECTED"]);
  });

  it("findByAuthorWorksiteAndDate finds the report, and nothing for another author or date", async () => {
    const report = await insertReport(prisma, { workDate: "2026-11-20" });
    const other = await insertUser(prisma);
    const worksiteId = toWorksiteId(report.worksiteId);

    const found = await reports.findByAuthorWorksiteAndDate(
      toUserId(report.authorId),
      worksiteId,
      toWorkDate("2026-11-20"),
    );
    const otherAuthor = await reports.findByAuthorWorksiteAndDate(
      toUserId(other.id),
      worksiteId,
      toWorkDate("2026-11-20"),
    );
    const otherDate = await reports.findByAuthorWorksiteAndDate(
      toUserId(report.authorId),
      worksiteId,
      toWorkDate("2026-11-21"),
    );

    expect(found?.id).toBe(report.id);
    expect(found?.workDate).toBe("2026-11-20");
    expect(otherAuthor).toBeUndefined();
    expect(otherDate).toBeUndefined();
  });
});

describe("PrismaDailyReportRepository.saveApproval", () => {
  const prisma = createPrismaClient(databaseUrl);
  const reports = new PrismaDailyReportRepository(prisma);
  const ApprovedAt = new Date("2026-11-21T03:00:00Z");

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  interface Site {
    readonly worksiteId: string;
    readonly authorId: string;
    readonly supervisorId: string;
  }

  async function aSite(): Promise<Site> {
    const supervisor = await insertUser(prisma, { role: "SITE_SUPERVISOR" });
    const author = await insertUser(prisma);
    const worksite = await insertWorksite(prisma, { supervisorId: supervisor.id });
    return { worksiteId: worksite.id, authorId: author.id, supervisorId: supervisor.id };
  }

  /** A task last changed long ago, so a test can tell whether approval wrote it. */
  async function aTaskAt(site: Site, approvedProgress: number): Promise<string> {
    const task = await insertTask(prisma, {
      worksiteId: site.worksiteId,
      assigneeId: site.authorId,
      approvedProgress,
      createdAt: LONG_AGO,
      updatedAt: LONG_AGO,
    });
    return task.id;
  }

  /** A SUBMITTED report, version 2, with one DRAFT → SUBMITTED transition, as loaded by the repository. */
  async function aSubmittedReport(
    site: Site,
    workDate: string,
    items: readonly { taskId: string; reportedProgress: number }[],
  ): Promise<DailyReport> {
    const row = await insertReport(prisma, {
      worksiteId: site.worksiteId,
      authorId: site.authorId,
      workDate,
      status: "SUBMITTED",
      version: 2,
    });
    for (const { taskId, reportedProgress } of items) {
      await insertReportItem(prisma, { reportId: row.id, taskId, reportedProgress });
    }
    await insertTransition(prisma, { reportId: row.id, actorId: site.authorId });
    const loaded = await reports.findById(toReportId(row.id));
    if (loaded === undefined) {
      throw new Error("the prepared report did not load");
    }
    return loaded;
  }

  /** What DailyReport.approve returns: APPROVED, with one more transition by the supervisor. */
  function approvedBy(report: DailyReport, supervisorId: string): DailyReport {
    return changed(report, {
      status: ReportStatus.APPROVED,
      transitions: [
        ...report.transitions,
        {
          from: ReportStatus.SUBMITTED,
          to: ReportStatus.APPROVED,
          actorId: toUserId(supervisorId),
          occurredAt: ApprovedAt,
          reason: null,
        },
      ],
    });
  }

  async function taskRow(id: string): Promise<{ approvedProgress: number; updatedAt: Date }> {
    return prisma.task.findUniqueOrThrow({ where: { id }, select: { approvedProgress: true, updatedAt: true } });
  }

  async function approvalCount(reportId: string): Promise<number> {
    return prisma.reportTransition.count({ where: { reportId, toStatus: "APPROVED" } });
  }

  it("BR-9 approval writes the status, version + 1, the transition and every item's task, and no other task", async () => {
    const site = await aSite();
    const walls = await aTaskAt(site, 40);
    const roof = await aTaskAt(site, 10);
    const untouched = await aTaskAt(site, 5);
    const report = await aSubmittedReport(site, "2026-11-20", [
      { taskId: walls, reportedProgress: 55 },
      { taskId: roof, reportedProgress: 20 },
    ]);

    const stored = await reports.saveApproval(approvedBy(report, site.supervisorId), report.version);

    expect(stored.status).toBe(ReportStatus.APPROVED);
    expect(stored.version).toBe(3);
    expect(stored.transitions.map((transition) => transition.to)).toEqual([
      ReportStatus.SUBMITTED,
      ReportStatus.APPROVED,
    ]);
    expect(stored.transitions[1]).toEqual(
      expect.objectContaining({ actorId: site.supervisorId, occurredAt: ApprovedAt, reason: null }),
    );
    expect((await taskRow(walls)).approvedProgress).toBe(55);
    expect((await taskRow(roof)).approvedProgress).toBe(20);
    expect(await taskRow(untouched)).toEqual({ approvedProgress: 5, updatedAt: LONG_AGO });
  });

  it("BR-9 a task reported at its current approved progress is not written", async () => {
    const site = await aSite();
    const walls = await aTaskAt(site, 40);
    const roof = await aTaskAt(site, 10);
    const report = await aSubmittedReport(site, "2026-11-20", [
      { taskId: walls, reportedProgress: 40 },
      { taskId: roof, reportedProgress: 20 },
    ]);

    await reports.saveApproval(approvedBy(report, site.supervisorId), report.version);

    expect(await taskRow(walls)).toEqual({ approvedProgress: 40, updatedAt: LONG_AGO });
    expect(await taskRow(roof)).toEqual(expect.objectContaining({ approvedProgress: 20 }));
    expect((await taskRow(roof)).updatedAt).not.toEqual(LONG_AGO);
  });

  it("BR-9 an approval where one of two tasks is already higher rolls back: the report stays SUBMITTED and no task changes", async () => {
    const site = await aSite();
    const walls = await aTaskAt(site, 40);
    const roof = await aTaskAt(site, 10);
    const report = await aSubmittedReport(site, "2026-11-20", [
      { taskId: walls, reportedProgress: 55 },
      { taskId: roof, reportedProgress: 20 },
    ]);
    // Another approval raised the roof task since submission. The updated_at trigger stamps this write too.
    await prisma.task.update({ where: { id: roof }, data: { approvedProgress: 30 } });
    const roofBefore = await prisma.task.findUniqueOrThrow({ where: { id: roof } });

    const approval = reports.saveApproval(approvedBy(report, site.supervisorId), report.version);

    await expect(approval).rejects.toMatchObject({
      code: "REPORT_PROGRESS_OUTDATED",
      details: { tasks: [{ taskId: roof, taskName: roofBefore.name, reportedProgress: 20, approvedProgress: 30 }] },
    });
    expect(await prisma.dailyReport.findUniqueOrThrow({ where: { id: report.id } })).toEqual(
      expect.objectContaining({ status: "SUBMITTED", version: 2 }),
    );
    expect(await prisma.reportTransition.count({ where: { reportId: report.id } })).toBe(1);
    expect(await taskRow(walls)).toEqual({ approvedProgress: 40, updatedAt: LONG_AGO });
    expect(await taskRow(roof)).toEqual({ approvedProgress: 30, updatedAt: roofBefore.updatedAt });
  });

  it("BR-5 with both tasks already higher, the refusal lists both in item order", async () => {
    const site = await aSite();
    const walls = await aTaskAt(site, 40);
    const roof = await aTaskAt(site, 10);
    const report = await aSubmittedReport(site, "2026-11-20", [
      { taskId: walls, reportedProgress: 55 },
      { taskId: roof, reportedProgress: 20 },
    ]);
    await prisma.task.updateMany({ where: { id: { in: [walls, roof] } }, data: { approvedProgress: 90 } });

    const approval = reports.saveApproval(approvedBy(report, site.supervisorId), report.version);

    await expect(approval).rejects.toMatchObject({
      code: "REPORT_PROGRESS_OUTDATED",
      details: {
        tasks: report.items.map((reportItem) =>
          expect.objectContaining({ taskId: reportItem.taskId, approvedProgress: 90 }),
        ),
      },
    });
  });

  it("BR-5 reports approved out of date order: approving the 19th at 40% after the 20th at 60% fails", async () => {
    const site = await aSite();
    const walls = await aTaskAt(site, 40);
    const nineteenth = await aSubmittedReport(site, "2026-11-19", [{ taskId: walls, reportedProgress: 40 }]);
    const twentieth = await aSubmittedReport(site, "2026-11-20", [{ taskId: walls, reportedProgress: 60 }]);

    await reports.saveApproval(approvedBy(twentieth, site.supervisorId), twentieth.version);
    const late = reports.saveApproval(approvedBy(nineteenth, site.supervisorId), nineteenth.version);

    await expect(late).rejects.toMatchObject({ code: "REPORT_PROGRESS_OUTDATED" });
    expect((await taskRow(walls)).approvedProgress).toBe(60);
    expect((await prisma.dailyReport.findUniqueOrThrow({ where: { id: nineteenth.id } })).status).toBe("SUBMITTED");
  });

  it("BR-15 two approvals of the same report started together: exactly one succeeds", async () => {
    const site = await aSite();
    const walls = await aTaskAt(site, 40);
    const report = await aSubmittedReport(site, "2026-11-20", [{ taskId: walls, reportedProgress: 55 }]);
    const approved = approvedBy(report, site.supervisorId);

    const outcomes = await Promise.allSettled([
      reports.saveApproval(approved, report.version),
      reports.saveApproval(approved, report.version),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ConflictError);
    expect(rejected[0]?.reason).toMatchObject({ code: "REPORT_VERSION_CONFLICT", details: { currentVersion: 3 } });
    expect(await approvalCount(report.id)).toBe(1);
    expect((await taskRow(walls)).approvedProgress).toBe(55);
  });

  it("BR-5 two reports sharing a task, at 50% and 60%, approved together never leave the task at 50%", async () => {
    const site = await aSite();
    const walls = await aTaskAt(site, 40);
    const fifty = await aSubmittedReport(site, "2026-11-19", [{ taskId: walls, reportedProgress: 50 }]);
    const sixty = await aSubmittedReport(site, "2026-11-20", [{ taskId: walls, reportedProgress: 60 }]);

    const [fiftyOutcome, sixtyOutcome] = await Promise.allSettled([
      reports.saveApproval(approvedBy(fifty, site.supervisorId), fifty.version),
      reports.saveApproval(approvedBy(sixty, site.supervisorId), sixty.version),
    ]);

    expect(sixtyOutcome?.status).toBe("fulfilled");
    if (fiftyOutcome?.status === "rejected") {
      expect(fiftyOutcome.reason).toMatchObject({ code: "REPORT_PROGRESS_OUTDATED" });
    }
    expect((await taskRow(walls)).approvedProgress).toBe(60);
  });

  it("two reports sharing two tasks approved together do not deadlock", async () => {
    // Guards the lock order (research R4). The two transactions may not overlap on every run, so this catches a
    // regression rather than proving that a deadlock cannot happen; the sorted update order is the proof.
    const site = await aSite();
    const first = await aTaskAt(site, 0);
    const second = await aTaskAt(site, 0);
    const a = await aSubmittedReport(site, "2026-11-19", [
      { taskId: first, reportedProgress: 30 },
      { taskId: second, reportedProgress: 70 },
    ]);
    const b = await aSubmittedReport(site, "2026-11-20", [
      { taskId: second, reportedProgress: 60 },
      { taskId: first, reportedProgress: 40 },
    ]);

    const outcomes = await Promise.allSettled([
      reports.saveApproval(approvedBy(a, site.supervisorId), a.version),
      reports.saveApproval(approvedBy(b, site.supervisorId), b.version),
    ]);

    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        expect(outcome.reason).toMatchObject({ code: "REPORT_PROGRESS_OUTDATED" });
      }
    }
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    const [firstRow, secondRow] = [await taskRow(first), await taskRow(second)];
    const approvedA = outcomes[0]?.status === "fulfilled";
    const approvedB = outcomes[1]?.status === "fulfilled";
    expect(firstRow.approvedProgress).toBe(approvedB ? 40 : 30);
    expect(secondRow.approvedProgress).toBe(approvedA ? 70 : 60);
  });

  describe("save, rejecting (004)", () => {
    const Reason = "conduit laid, no wiring pulled yet";

    /** What DailyReport.reject returns: REJECTED, with one more transition by the supervisor, carrying the reason. */
    function rejectedBy(report: DailyReport, supervisorId: string): DailyReport {
      return changed(report, {
        status: ReportStatus.REJECTED,
        transitions: [
          ...report.transitions,
          {
            from: ReportStatus.SUBMITTED,
            to: ReportStatus.REJECTED,
            actorId: toUserId(supervisorId),
            occurredAt: ApprovedAt,
            reason: Reason,
          },
        ],
      });
    }

    it("BR-11 saving a rejected report stores the transition with its reason and leaves the items untouched", async () => {
      const site = await aSite();
      const electrical = await aTaskAt(site, 0);
      const report = await aSubmittedReport(site, "2026-11-20", [{ taskId: electrical, reportedProgress: 10 }]);
      const itemBefore = await prisma.reportItem.findUniqueOrThrow({
        where: { reportTask: { reportId: report.id, taskId: electrical } },
      });

      const stored = await reports.save(rejectedBy(report, site.supervisorId), report.version);

      expect(stored.status).toBe(ReportStatus.REJECTED);
      expect(stored.version).toBe(3);
      const rows = await prisma.reportTransition.findMany({ where: { reportId: report.id, toStatus: "REJECTED" } });
      expect(rows).toEqual([
        expect.objectContaining({ fromStatus: "SUBMITTED", actorId: site.supervisorId, reason: Reason }),
      ]);
      const itemAfter = await prisma.reportItem.findUniqueOrThrow({
        where: { reportTask: { reportId: report.id, taskId: electrical } },
      });
      expect(itemAfter.updatedAt).toEqual(itemBefore.updatedAt);
      expect(await taskRow(electrical)).toEqual({ approvedProgress: 0, updatedAt: LONG_AGO });
    });

    it("BR-15 approve and reject started together: exactly one succeeds", async () => {
      const site = await aSite();
      const electrical = await aTaskAt(site, 0);
      const report = await aSubmittedReport(site, "2026-11-20", [{ taskId: electrical, reportedProgress: 10 }]);

      const [approval, rejection] = await Promise.allSettled([
        reports.saveApproval(approvedBy(report, site.supervisorId), report.version),
        reports.save(rejectedBy(report, site.supervisorId), report.version),
      ]);

      const outcomes = [approval, rejection];
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      const loser = outcomes.find((outcome) => outcome.status === "rejected");
      expect(loser?.status === "rejected" ? loser.reason : undefined).toMatchObject({
        code: "REPORT_VERSION_CONFLICT",
        details: { currentVersion: 3 },
      });
      const decisions = await prisma.reportTransition.count({
        where: { reportId: report.id, toStatus: { in: ["APPROVED", "REJECTED"] } },
      });
      expect(decisions).toBe(1);
      const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: report.id } });
      if (approval.status === "fulfilled") {
        expect(row.status).toBe("APPROVED");
        expect((await taskRow(electrical)).approvedProgress).toBe(10);
      } else {
        expect(row.status).toBe("REJECTED");
        expect(await taskRow(electrical)).toEqual({ approvedProgress: 0, updatedAt: LONG_AGO });
      }
    });
  });
});
