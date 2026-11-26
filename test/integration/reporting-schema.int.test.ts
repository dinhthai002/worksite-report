import { createPrismaClient } from "@src/shared/infrastructure/db";
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

/** Constraints and triggers of the reporting tables (specs/002-draft-and-submit/data-model.md section 2). */
describe("reporting schema", () => {
  const prisma = createPrismaClient(databaseUrl);

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("daily_reports", () => {
    it("BR-1 the unique key rejects a second report for the same foreman, worksite and work date", async () => {
      const report = await insertReport(prisma);

      await expect(
        insertReport(prisma, { worksiteId: report.worksiteId, authorId: report.authorId, workDate: "2026-11-20" }),
      ).rejects.toThrow(/Unique constraint/);
    });

    it("BR-1 accepts the same foreman and work date on another worksite", async () => {
      const report = await insertReport(prisma);

      const other = await insertReport(prisma, { authorId: report.authorId, workDate: "2026-11-20" });

      expect(other.worksiteId).not.toBe(report.worksiteId);
    });

    it("rejects version 0", async () => {
      await expect(insertReport(prisma, { version: 0 })).rejects.toThrow(/daily_reports_version_positive/);
    });

    it("rejects a note of 2,001 characters and accepts 2,000", async () => {
      await expect(insertReport(prisma, { note: "x".repeat(2001) })).rejects.toThrow(/daily_reports_note_length/);

      const report = await insertReport(prisma, { note: "x".repeat(2000) });

      expect(report.note).toHaveLength(2000);
    });
  });

  describe("report_items", () => {
    it("BR-4 the primary key rejects the same task twice in a report", async () => {
      const report = await insertReport(prisma);
      const task = await insertTask(prisma, { worksiteId: report.worksiteId, assigneeId: report.authorId });
      await insertReportItem(prisma, { reportId: report.id, taskId: task.id });

      await expect(insertReportItem(prisma, { reportId: report.id, taskId: task.id })).rejects.toThrow(
        /Unique constraint/,
      );
    });

    it.each([-1, 101])("BR-5 reported_progress %i is rejected by the database", async (reportedProgress) => {
      const report = await insertReport(prisma);
      const task = await insertTask(prisma, { worksiteId: report.worksiteId });

      await expect(
        insertReportItem(prisma, { reportId: report.id, taskId: task.id, reportedProgress }),
      ).rejects.toThrow(/report_items_reported_progress_range/);
    });

    it.each([0, 100])("BR-5 reported_progress %i is accepted", async (reportedProgress) => {
      const report = await insertReport(prisma);
      const task = await insertTask(prisma, { worksiteId: report.worksiteId });

      const item = await insertReportItem(prisma, { reportId: report.id, taskId: task.id, reportedProgress });

      expect(item.reportedProgress).toBe(reportedProgress);
    });

    it("rejects a note of 2,001 characters", async () => {
      const report = await insertReport(prisma);
      const task = await insertTask(prisma, { worksiteId: report.worksiteId });

      await expect(
        insertReportItem(prisma, { reportId: report.id, taskId: task.id, note: "x".repeat(2001) }),
      ).rejects.toThrow(/report_items_note_length/);
    });
  });

  describe("report_transitions", () => {
    it("BR-11 report_transitions rejects UPDATE", async () => {
      const report = await insertReport(prisma, { status: "SUBMITTED" });
      const transition = await insertTransition(prisma, { reportId: report.id, actorId: report.authorId });

      await expect(
        prisma.reportTransition.update({ where: { id: transition.id }, data: { reason: "changed" } }),
      ).rejects.toThrow(/append-only/);
    });

    it("BR-11 report_transitions rejects DELETE", async () => {
      const report = await insertReport(prisma, { status: "SUBMITTED" });
      const transition = await insertTransition(prisma, { reportId: report.id, actorId: report.authorId });

      await expect(prisma.reportTransition.delete({ where: { id: transition.id } })).rejects.toThrow(/append-only/);
    });

    it.each([
      ["NULL", null],
      ["empty", ""],
      ["whitespace-only", " \t\n "],
    ])("BR-8 rejects a REJECTED transition with a %s reason", async (_label, reason) => {
      const report = await insertReport(prisma, { status: "REJECTED" });

      await expect(
        insertTransition(prisma, {
          reportId: report.id,
          actorId: report.authorId,
          fromStatus: "SUBMITTED",
          toStatus: "REJECTED",
          reason,
        }),
      ).rejects.toThrow(/report_transitions_rejection_reason/);
    });

    it("BR-8 accepts a REJECTED transition with a reason, and a SUBMITTED transition with none", async () => {
      const report = await insertReport(prisma, { status: "REJECTED" });

      const submitted = await insertTransition(prisma, { reportId: report.id, actorId: report.authorId });
      const rejected = await insertTransition(prisma, {
        reportId: report.id,
        actorId: report.authorId,
        fromStatus: "SUBMITTED",
        toStatus: "REJECTED",
        reason: "conduit laid, no wiring pulled yet",
      });

      expect([submitted.reason, rejected.reason]).toEqual([null, "conduit laid, no wiring pulled yet"]);
    });

    it("rejects a reason of 2,001 characters and accepts 2,000", async () => {
      const report = await insertReport(prisma, { status: "REJECTED" });
      const rejection = {
        reportId: report.id,
        actorId: report.authorId,
        fromStatus: "SUBMITTED",
        toStatus: "REJECTED",
      } as const;

      await expect(insertTransition(prisma, { ...rejection, reason: "x".repeat(2001) })).rejects.toThrow(
        /report_transitions_reason_length/,
      );

      const accepted = await insertTransition(prisma, { ...rejection, reason: "x".repeat(2000) });

      expect(accepted.reason).toHaveLength(2000);
    });
  });

  describe("idempotency_keys", () => {
    it("BR-14 the primary key rejects a second claim of the same actor and key", async () => {
      const actor = await insertUser(prisma);
      await prisma.idempotencyKey.create({ data: { actorId: actor.id, key: "k1", requestHash: "a" } });

      await expect(
        prisma.idempotencyKey.create({ data: { actorId: actor.id, key: "k1", requestHash: "a" } }),
      ).rejects.toThrow(/Unique constraint/);
    });

    it("BR-14 accepts the same key for two actors", async () => {
      const mark = await insertUser(prisma);
      const henry = await insertUser(prisma);
      await prisma.idempotencyKey.create({ data: { actorId: mark.id, key: "k1", requestHash: "a" } });

      const henrys = await prisma.idempotencyKey.create({ data: { actorId: henry.id, key: "k1", requestHash: "b" } });

      expect(henrys.actorId).toBe(henry.id);
    });

    it("BR-14 rejects a response status without a completion time", async () => {
      const actor = await insertUser(prisma);

      await expect(
        prisma.idempotencyKey.create({
          data: { actorId: actor.id, key: "k1", requestHash: "a", responseStatus: 201, responseBody: {} },
        }),
      ).rejects.toThrow(/idempotency_keys_completion/);
    });

    it("rejects an empty key", async () => {
      const actor = await insertUser(prisma);

      await expect(
        prisma.idempotencyKey.create({ data: { actorId: actor.id, key: "", requestHash: "a" } }),
      ).rejects.toThrow(/idempotency_keys_key_length/);
    });
  });

  describe("created_at and updated_at (architecture.md 5.5)", () => {
    it("advances daily_reports.updated_at on update and keeps created_at", async () => {
      const report = await insertReport(prisma, { createdAt: LONG_AGO, updatedAt: LONG_AGO });

      const updated = await prisma.dailyReport.update({ where: { id: report.id }, data: { note: "changed" } });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
      expect(updated.createdAt).toEqual(LONG_AGO);
    });

    it("advances report_items.updated_at on update and keeps created_at", async () => {
      const report = await insertReport(prisma);
      const task = await insertTask(prisma, { worksiteId: report.worksiteId });
      await insertReportItem(prisma, {
        reportId: report.id,
        taskId: task.id,
        createdAt: LONG_AGO,
        updatedAt: LONG_AGO,
      });

      const updated = await prisma.reportItem.update({
        where: { reportTask: { reportId: report.id, taskId: task.id } },
        data: { reportedProgress: 10 },
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
      expect(updated.createdAt).toEqual(LONG_AGO);
    });

    it("advances idempotency_keys.updated_at on update and keeps created_at", async () => {
      const actor = await insertUser(prisma);
      await prisma.idempotencyKey.create({
        data: { actorId: actor.id, key: "k1", requestHash: "a", createdAt: LONG_AGO, updatedAt: LONG_AGO },
      });

      const updated = await prisma.idempotencyKey.update({
        where: { actorKey: { actorId: actor.id, key: "k1" } },
        data: { responseStatus: 201, responseBody: {}, completedAt: new Date() },
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
      expect(updated.createdAt).toEqual(LONG_AGO);
    });

    it("keeps worksite rows untouched by report writes", async () => {
      const worksite = await insertWorksite(prisma, { createdAt: LONG_AGO, updatedAt: LONG_AGO });

      await insertReport(prisma, { worksiteId: worksite.id });

      const reloaded = await prisma.worksite.findUniqueOrThrow({ where: { id: worksite.id } });
      expect(reloaded.updatedAt).toEqual(LONG_AGO);
    });
  });
});
