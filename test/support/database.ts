import { randomUUID } from "node:crypto";
import type { Task, User, UserRole, Worksite, WorksiteStatus } from "@prisma/client";
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

function times(row: Timestamps): Timestamps {
  return {
    ...(row.createdAt === undefined ? {} : { createdAt: row.createdAt }),
    ...(row.updatedAt === undefined ? {} : { updatedAt: row.updatedAt }),
  };
}
