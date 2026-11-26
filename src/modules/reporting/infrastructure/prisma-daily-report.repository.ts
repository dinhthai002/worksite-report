import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { UserId } from "../../../shared/domain/actor";
import { ConflictError } from "../../../shared/domain/errors";
import type { WorksiteId } from "../../../shared/domain/ids";
import { toProgress } from "../../../shared/domain/progress";
import type { DatabaseClient } from "../../../shared/infrastructure/db";
import {
  type DailyReport,
  type OutdatedItem,
  progressOutdated,
  type ReportId,
  type WorkDate,
} from "../domain/daily-report";
import type { AddResult, DailyReportRepository } from "../domain/daily-report.repository";
import { toDailyReport, toDateColumn } from "./daily-report.mapper";

type TransactionClient = Prisma.TransactionClient;

interface WithChildren {
  readonly items: { readonly orderBy: Prisma.ReportItemOrderByWithRelationInput[] };
  readonly transitions: { readonly orderBy: Prisma.ReportTransitionOrderByWithRelationInput[] };
}

/** FR-032: items last changed first; transitions oldest first (the recorded exception). */
const WITH_CHILDREN: WithChildren = {
  items: { orderBy: [{ updatedAt: "desc" }, { createdAt: "asc" }, { taskId: "asc" }] },
  transitions: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] },
};

export class PrismaDailyReportRepository implements DailyReportRepository {
  private readonly client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.client = client;
  }

  async findById(id: ReportId): Promise<DailyReport | undefined> {
    const row = await this.client.dailyReport.findUnique({ where: { id }, include: WITH_CHILDREN });
    return row === null ? undefined : toDailyReport(row);
  }

  async findByAuthorWorksiteAndDate(
    authorId: UserId,
    worksiteId: WorksiteId,
    workDate: WorkDate,
  ): Promise<DailyReport | undefined> {
    const row = await this.client.dailyReport.findFirst({
      where: { authorId, worksiteId, workDate: toDateColumn(workDate) },
      include: WITH_CHILDREN,
    });
    return row === null ? undefined : toDailyReport(row);
  }

  async add(report: DailyReport): Promise<AddResult> {
    try {
      const row = await this.client.dailyReport.create({
        data: {
          id: report.id,
          worksiteId: report.worksiteId,
          authorId: report.authorId,
          workDate: toDateColumn(report.workDate),
          status: report.status,
          version: 1,
          note: report.note,
          items: {
            create: report.items.map((item) => ({
              taskId: item.taskId,
              reportedProgress: item.reportedProgress,
              note: item.note,
            })),
          },
        },
        include: WITH_CHILDREN,
      });
      return { created: true, report: toDailyReport(row) };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // BR-1: another request created the report first. Answer with that report, unchanged (research R8).
      const existing = await this.findByAuthorWorksiteAndDate(report.authorId, report.worksiteId, report.workDate);
      if (existing === undefined) {
        throw new ConflictError("REPORT_ALREADY_EXISTS", `A report with ID ${report.id} already exists.`, {
          reportId: report.id,
        });
      }
      return { created: false, report: existing };
    }
  }

  async save(report: DailyReport, expectedVersion: number): Promise<DailyReport> {
    const row = await this.client.$transaction(async (tx) => {
      // BR-15: the write applies only to the version the caller read, and increments it (DB-03, ADR 0003).
      const updated = await tx.dailyReport.updateMany({
        where: { id: report.id, version: expectedVersion },
        data: { note: report.note, status: report.status, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw await versionConflict(tx, report.id, expectedVersion);
      }
      await writeItems(tx, report);
      await appendTransitions(tx, report);
      return tx.dailyReport.findUniqueOrThrow({ where: { id: report.id }, include: WITH_CHILDREN });
    });
    return toDailyReport(row);
  }

  /**
   * UC-3: writes an approval decided by DailyReport.approve, in one transaction (ADR 0004). This is the only write by
   * the reporting module to a table owned by the worksite module.
   */
  async saveApproval(report: DailyReport, expectedVersion: number): Promise<DailyReport> {
    const row = await this.client.$transaction(async (tx) => {
      // BR-15: only the version the caller read, and only while SUBMITTED (ADR 0004).
      const updated = await tx.dailyReport.updateMany({
        where: { id: report.id, version: expectedVersion, status: "SUBMITTED" },
        data: { status: report.status, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw await versionConflict(tx, report.id, expectedVersion);
      }
      await raiseApprovedProgress(tx, report);
      await appendTransitions(tx, report);
      return tx.dailyReport.findUniqueOrThrow({ where: { id: report.id }, include: WITH_CHILDREN });
    });
    return toDailyReport(row);
  }
}

/**
 * BR-9: every item's task gets the item's reported progress. A task is raised only when below it, so a task already at
 * that value is not written and keeps its place in the worksite's list (spec FR-002). A task not raised must not be
 * above the reported progress (BR-5 guard against a concurrent approval); if any is, the approval fails and the
 * transaction rolls back (research R4).
 */
async function raiseApprovedProgress(tx: TransactionClient, report: DailyReport): Promise<void> {
  // Research R4: one lock order for every approval, so two approvals sharing tasks cannot deadlock.
  const byTaskId = [...report.items].sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0));
  const notRaised = new Set<string>();
  for (const item of byTaskId) {
    const raised = await tx.task.updateMany({
      where: { id: item.taskId, worksiteId: report.worksiteId, approvedProgress: { lt: item.reportedProgress } },
      data: { approvedProgress: item.reportedProgress },
    });
    if (raised.count === 0) {
      notRaised.add(item.taskId);
    }
  }
  if (notRaised.size === 0) {
    return;
  }
  const tasks = await tx.task.findMany({
    where: { id: { in: [...notRaised] }, worksiteId: report.worksiteId },
    select: { id: true, name: true, approvedProgress: true },
  });
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const outdated: OutdatedItem[] = [];
  for (const item of report.items.filter((candidate) => notRaised.has(candidate.taskId))) {
    const task = taskById.get(item.taskId);
    if (task === undefined) {
      throw new Error(
        `Report ${report.id} refers to task ${item.taskId}, which is not in worksite ${report.worksiteId}`,
      );
    }
    // BR-5 guard: equal is fine; above means another approval has moved past this report.
    if (task.approvedProgress > item.reportedProgress) {
      outdated.push({
        taskId: item.taskId,
        taskName: task.name,
        reportedProgress: item.reportedProgress,
        approvedProgress: toProgress(task.approvedProgress),
      });
    }
  }
  if (outdated.length > 0) {
    throw progressOutdated(outdated);
  }
}

async function versionConflict(tx: TransactionClient, id: ReportId, expectedVersion: number): Promise<ConflictError> {
  const current = await tx.dailyReport.findUnique({ where: { id }, select: { version: true } });
  const currentVersion = current?.version ?? null;
  return new ConflictError(
    "REPORT_VERSION_CONFLICT",
    `The report has changed since you read it (your version ${expectedVersion}, current version ${currentVersion}). Reload it and try again.`,
    { expectedVersion, currentVersion },
  );
}

/**
 * FR-002: the report's items become exactly report.items. Only changed items are written, so updated_at keeps
 * meaning "last changed" for FR-032 (research R11).
 */
async function writeItems(tx: TransactionClient, report: DailyReport): Promise<void> {
  const stored = await tx.reportItem.findMany({ where: { reportId: report.id } });
  const storedByTask = new Map(stored.map((item) => [item.taskId, item]));
  const wanted = new Set<string>(report.items.map((item) => item.taskId));

  await tx.reportItem.deleteMany({ where: { reportId: report.id, taskId: { notIn: [...wanted] } } });

  for (const item of report.items) {
    const existing = storedByTask.get(item.taskId);
    if (existing === undefined) {
      await tx.reportItem.create({
        data: { reportId: report.id, taskId: item.taskId, reportedProgress: item.reportedProgress, note: item.note },
      });
    } else if (existing.reportedProgress !== item.reportedProgress || existing.note !== item.note) {
      await tx.reportItem.update({
        where: { reportTask: { reportId: report.id, taskId: item.taskId } },
        data: { reportedProgress: item.reportedProgress, note: item.note },
      });
    }
  }
}

/** BR-11: transitions are append-only, so the stored ones are always the first ones; insert the rest. */
async function appendTransitions(tx: TransactionClient, report: DailyReport): Promise<void> {
  const storedCount = await tx.reportTransition.count({ where: { reportId: report.id } });
  const added = report.transitions.slice(storedCount);
  if (added.length === 0) {
    return;
  }
  await tx.reportTransition.createMany({
    data: added.map((transition) => ({
      id: randomUUID(),
      reportId: report.id,
      fromStatus: transition.from,
      toStatus: transition.to,
      actorId: transition.actorId,
      occurredAt: transition.occurredAt,
      reason: transition.reason,
    })),
  });
}

/** ERR-04: P2002 is a unique constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
