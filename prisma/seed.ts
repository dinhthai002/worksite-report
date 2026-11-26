import type { UserRole, WorksiteStatus } from "@prisma/client";
import { type Config, loadConfig } from "../src/config";
import { createPrismaClient, type DatabaseClient } from "../src/shared/infrastructure/db";
import { createLogger } from "../src/shared/infrastructure/logger";

/**
 * The PRD's three-storey townhouse example (spec US3; data-model.md section 4; contracts/seed-command.md).
 *
 * - `fill` (default; run by the compose `migrate` service on every start): inserts the example rows that are
 *   missing and changes no existing row (FR-018a).
 * - `reset` (`npx prisma db seed`, which passes `--reset`): sets every example row back to the PRD values and
 *   inserts the missing ones (FR-018b).
 *
 * Both run in one transaction and touch only rows with the example's fixed IDs (FR-017, FR-018).
 */

export type SeedMode = "fill" | "reset";

interface ExampleUser {
  readonly id: string;
  readonly name: string;
  readonly role: UserRole;
}

interface ExampleWorksite {
  readonly id: string;
  readonly name: string;
  readonly supervisorId: string;
  readonly status: WorksiteStatus;
}

interface ExampleTask {
  readonly id: string;
  readonly worksiteId: string;
  readonly name: string;
  readonly assigneeId: string;
  readonly approvedProgress: number;
}

export interface Example {
  readonly users: readonly ExampleUser[];
  readonly worksites: readonly ExampleWorksite[];
  readonly tasks: readonly ExampleTask[];
}

const LINDA = "00000000-0000-4000-8000-000000000001";
const MARK = "00000000-0000-4000-8000-000000000002";
const HENRY = "00000000-0000-4000-8000-000000000003";
const TOWNHOUSE = "00000000-0000-4000-8000-000000000101";

/** Fixed IDs, the same on every installation (FR-017, research R7). */
export const EXAMPLE: Example = {
  users: [
    { id: LINDA, name: "Linda", role: "SITE_SUPERVISOR" },
    { id: MARK, name: "Mark", role: "FOREMAN" },
    { id: HENRY, name: "Henry", role: "FOREMAN" },
  ],
  worksites: [{ id: TOWNHOUSE, name: "Three-storey townhouse", supervisorId: LINDA, status: "ACTIVE" }],
  tasks: [
    {
      id: "00000000-0000-4000-8000-000000000201",
      worksiteId: TOWNHOUSE,
      name: "Pour foundation",
      assigneeId: MARK,
      approvedProgress: 100,
    },
    {
      id: "00000000-0000-4000-8000-000000000202",
      worksiteId: TOWNHOUSE,
      name: "Build ground-floor walls",
      assigneeId: MARK,
      approvedProgress: 40,
    },
    {
      id: "00000000-0000-4000-8000-000000000203",
      worksiteId: TOWNHOUSE,
      name: "Install electrical",
      assigneeId: HENRY,
      approvedProgress: 0,
    },
  ],
};

/** Rows written: inserted ones for `fill`, inserted or reset ones for `reset`. */
export interface SeedResult {
  readonly users: number;
  readonly worksites: number;
  readonly tasks: number;
}

export async function loadExample(client: DatabaseClient, mode: SeedMode): Promise<SeedResult> {
  return mode === "fill" ? fill(client) : reset(client);
}

/** INSERT ... ON CONFLICT DO NOTHING: an existing row, and its updated_at, stay as they are (FR-018a). */
async function fill(client: DatabaseClient): Promise<SeedResult> {
  const [users, worksites, tasks] = await client.$transaction([
    client.user.createMany({ data: [...EXAMPLE.users], skipDuplicates: true }),
    client.worksite.createMany({ data: [...EXAMPLE.worksites], skipDuplicates: true }),
    client.task.createMany({ data: [...EXAMPLE.tasks], skipDuplicates: true }),
  ]);
  return { users: users.count, worksites: worksites.count, tasks: tasks.count };
}

/** Upsert by ID: PRD values back, created_at untouched, updated_at advanced by the trigger (FR-018b). */
async function reset(client: DatabaseClient): Promise<SeedResult> {
  await client.$transaction([
    ...EXAMPLE.users.map((user) =>
      client.user.upsert({ where: { id: user.id }, create: user, update: { name: user.name, role: user.role } }),
    ),
    ...EXAMPLE.worksites.map((worksite) =>
      client.worksite.upsert({
        where: { id: worksite.id },
        create: worksite,
        update: { name: worksite.name, supervisorId: worksite.supervisorId, status: worksite.status },
      }),
    ),
    ...EXAMPLE.tasks.map((task) =>
      client.task.upsert({
        where: { id: task.id },
        create: task,
        update: {
          worksiteId: task.worksiteId,
          name: task.name,
          assigneeId: task.assigneeId,
          approvedProgress: task.approvedProgress,
        },
      }),
    ),
  ]);
  return { users: EXAMPLE.users.length, worksites: EXAMPLE.worksites.length, tasks: EXAMPLE.tasks.length };
}

/** Command-line entry. Exit code 0 on success, 1 on failure (contracts/seed-command.md). */
async function main(argv: readonly string[]): Promise<void> {
  const mode: SeedMode = argv.includes("--reset") ? "reset" : "fill";

  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    createLogger("info").fatal({ err: error, mode }, "invalid configuration, example data not loaded");
    process.exitCode = 1;
    return;
  }

  const logger = createLogger(config.logLevel);
  const client = createPrismaClient(config.databaseUrl);
  try {
    const written = await loadExample(client, mode);
    logger.info({ mode, written }, "example data loaded");
  } catch (error) {
    logger.error({ err: error, mode }, "loading example data failed");
    process.exitCode = 1;
  } finally {
    await client.$disconnect();
  }
}

if (require.main === module) {
  void main(process.argv);
}
