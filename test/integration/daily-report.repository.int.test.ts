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
