import { randomUUID } from "node:crypto";
import type {
  DailyReport,
  ReportItem,
  ReportStatus,
  ReportTransition,
  Task,
  User,
  UserRole,
  Worksite,
  WorksiteStatus,
} from "@prisma/client";
import type { DatabaseClient } from "@src/shared/infrastructure/db";

/**
 * Empties every table except Prisma's migration history, so each integration or API test starts from a clean
 * database (TST-08). Tables added by later features are included without changing this helper.
 * Tagged $queryRaw with no interpolated values (DB-06).
 */
export async function truncateAll(client: DatabaseClient): Promise<void> {
  await client.$queryRaw`
    DO $$
    DECLARE statement text;
    BEGIN
      SELECT 'TRUNCATE TABLE ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ' CASCADE'
        INTO statement
        FROM pg_tables
       WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations';
      IF statement IS NOT NULL THEN
        EXECUTE statement;
      END IF;
    END $$`;
}

interface Timestamps {
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export interface UserRow extends Timestamps {
  readonly id?: string;
  readonly name?: string;
  readonly role?: UserRole;
}

export interface WorksiteRow extends Timestamps {
  readonly id?: string;
  readonly name?: string;
  readonly supervisorId?: string;
  readonly status?: WorksiteStatus;
}

export interface TaskRow extends Timestamps {
  readonly id?: string;
  readonly worksiteId?: string;
  readonly name?: string;
  readonly assigneeId?: string;
  readonly approvedProgress?: number;
}

/** Inserts a user. Defaults: a new ID, a Foreman (TST-10). */
export function insertUser(client: DatabaseClient, row: UserRow = {}): Promise<User> {
  return client.user.create({
    data: { id: row.id ?? randomUUID(), name: row.name ?? "Test user", role: row.role ?? "FOREMAN", ...times(row) },
  });
}

/** Inserts a worksite. Without a supervisor, a new Site Supervisor is inserted first (TST-10). */
export async function insertWorksite(client: DatabaseClient, row: WorksiteRow = {}): Promise<Worksite> {
  const supervisorId = row.supervisorId ?? (await insertUser(client, { role: "SITE_SUPERVISOR" })).id;
  return client.worksite.create({
    data: {
      id: row.id ?? randomUUID(),
      name: row.name ?? "Test worksite",
      supervisorId,
      ...(row.status === undefined ? {} : { status: row.status }),
      ...times(row),
    },
  });
}

/** Inserts a task. Without a worksite or an assignee, new ones are inserted first (TST-10). */
export async function insertTask(client: DatabaseClient, row: TaskRow = {}): Promise<Task> {
  const worksiteId = row.worksiteId ?? (await insertWorksite(client)).id;
  const assigneeId = row.assigneeId ?? (await insertUser(client)).id;
  return client.task.create({
    data: {
      id: row.id ?? randomUUID(),
      worksiteId,
      name: row.name ?? "Test task",
      assigneeId,
      ...(row.approvedProgress === undefined ? {} : { approvedProgress: row.approvedProgress }),
      ...times(row),
    },
  });
}

export interface ReportRow extends Timestamps {
  readonly id?: string;
  readonly worksiteId?: string;
  readonly authorId?: string;
  /** `YYYY-MM-DD`. */
  readonly workDate?: string;
  readonly status?: ReportStatus;
  readonly version?: number;
  readonly note?: string | null;
}

export interface ReportItemRow extends Timestamps {
  readonly reportId: string;
  readonly taskId: string;
  readonly reportedProgress?: number;
  readonly note?: string | null;
}

export interface TransitionRow {
  readonly id?: string;
  readonly reportId: string;
  readonly actorId: string;
  readonly fromStatus?: ReportStatus;
  readonly toStatus?: ReportStatus;
  readonly occurredAt?: Date;
  readonly reason?: string | null;
}

/**
 * Inserts a daily report directly, so a test can prepare a status no endpoint reaches yet (research R17).
 * Defaults: a new worksite and a new Foreman author, work date 2026-11-20, DRAFT, version 1, no note (TST-10).
 */
export async function insertReport(client: DatabaseClient, row: ReportRow = {}): Promise<DailyReport> {
  const worksiteId = row.worksiteId ?? (await insertWorksite(client)).id;
  const authorId = row.authorId ?? (await insertUser(client)).id;
  return client.dailyReport.create({
    data: {
      id: row.id ?? randomUUID(),
      worksiteId,
      authorId,
      workDate: new Date(`${row.workDate ?? "2026-11-20"}T00:00:00Z`),
      status: row.status ?? "DRAFT",
      version: row.version ?? 1,
      note: row.note ?? null,
      ...times(row),
    },
  });
}

/** Inserts a report item. Defaults: progress 0, no note (TST-10). */
export function insertReportItem(client: DatabaseClient, row: ReportItemRow): Promise<ReportItem> {
  return client.reportItem.create({
    data: {
      reportId: row.reportId,
      taskId: row.taskId,
      reportedProgress: row.reportedProgress ?? 0,
      note: row.note ?? null,
      ...times(row),
    },
  });
}

/** Inserts a transition. Defaults: DRAFT to SUBMITTED at 2026-11-20T10:00:00Z, no reason (TST-10). */
export function insertTransition(client: DatabaseClient, row: TransitionRow): Promise<ReportTransition> {
  return client.reportTransition.create({
    data: {
      id: row.id ?? randomUUID(),
      reportId: row.reportId,
      actorId: row.actorId,
      fromStatus: row.fromStatus ?? "DRAFT",
      toStatus: row.toStatus ?? "SUBMITTED",
      occurredAt: row.occurredAt ?? new Date("2026-11-20T10:00:00Z"),
      reason: row.reason ?? null,
    },
  });
}

function times(row: Timestamps): Timestamps {
  return {
    ...(row.createdAt === undefined ? {} : { createdAt: row.createdAt }),
    ...(row.updatedAt === undefined ? {} : { updatedAt: row.updatedAt }),
  };
}
