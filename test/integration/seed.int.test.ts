import { PrismaWorksiteRepository } from "@src/modules/worksite/infrastructure/prisma-worksite.repository";
import { toWorksiteId } from "@src/shared/domain/ids";
import { createPrismaClient } from "@src/shared/infrastructure/db";
import { EXAMPLE, loadExample } from "../../prisma/seed";
import { insertTask, insertUser, insertWorksite, truncateAll } from "../support/database";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is not set. Integration tests must run through Jest, which starts PostgreSQL.");
}

const LONG_AGO = new Date("2000-01-01T00:00:00Z");
const TOWNHOUSE = "00000000-0000-4000-8000-000000000101";
const MARK = "00000000-0000-4000-8000-000000000002";
const FOUNDATION = "00000000-0000-4000-8000-000000000201";
const WALLS = "00000000-0000-4000-8000-000000000202";
const ELECTRICAL = "00000000-0000-4000-8000-000000000203";

describe("prisma/seed.ts (US3)", () => {
  const prisma = createPrismaClient(databaseUrl);

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function exampleRows(): Promise<unknown> {
    const select = { orderBy: { id: "asc" as const } };
    const [users, worksites, tasks] = await Promise.all([
      prisma.user.findMany({ ...select, select: { id: true, name: true, role: true } }),
      prisma.worksite.findMany({ ...select, select: { id: true, name: true, supervisorId: true, status: true } }),
      prisma.task.findMany({
        ...select,
        select: { id: true, worksiteId: true, name: true, assigneeId: true, approvedProgress: true },
      }),
    ]);
    return { users, worksites, tasks };
  }

  async function counts(): Promise<[number, number, number]> {
    return Promise.all([prisma.user.count(), prisma.worksite.count(), prisma.task.count()]);
  }

  /** Inserts the example rows directly, with old timestamps, so a reset's changes are measurable. */
  async function insertExampleLongAgo(): Promise<void> {
    const times = { createdAt: LONG_AGO, updatedAt: LONG_AGO };
    for (const user of EXAMPLE.users) {
      await insertUser(prisma, { ...user, ...times });
    }
    for (const worksite of EXAMPLE.worksites) {
      await insertWorksite(prisma, { ...worksite, ...times });
    }
    for (const task of EXAMPLE.tasks) {
      await insertTask(prisma, { ...task, ...times });
    }
  }

  describe("fill", () => {
    it("loads the PRD example into an empty database (US3-1, US3-2)", async () => {
      await loadExample(prisma, "fill");

      expect(await exampleRows()).toEqual({
        users: [
          { id: "00000000-0000-4000-8000-000000000001", name: "Linda", role: "SITE_SUPERVISOR" },
          { id: MARK, name: "Mark", role: "FOREMAN" },
          { id: "00000000-0000-4000-8000-000000000003", name: "Henry", role: "FOREMAN" },
        ],
        worksites: [
          {
            id: TOWNHOUSE,
            name: "Three-storey townhouse",
            supervisorId: "00000000-0000-4000-8000-000000000001",
            status: "ACTIVE",
          },
        ],
        tasks: [
          { id: FOUNDATION, worksiteId: TOWNHOUSE, name: "Pour foundation", assigneeId: MARK, approvedProgress: 100 },
          {
            id: WALLS,
            worksiteId: TOWNHOUSE,
            name: "Build ground-floor walls",
            assigneeId: MARK,
            approvedProgress: 40,
          },
          {
            id: ELECTRICAL,
            worksiteId: TOWNHOUSE,
            name: "Install electrical",
            assigneeId: "00000000-0000-4000-8000-000000000003",
            approvedProgress: 0,
          },
        ],
      });
    });

    it("leaves exactly one copy of each row when run twice (FR-018, SC-004)", async () => {
      await loadExample(prisma, "fill");

      const second = await loadExample(prisma, "fill");

      expect(second).toEqual({ users: 0, worksites: 0, tasks: 0 });
      expect(await counts()).toEqual([3, 1, 3]);
    });

    it("keeps a changed value and its last-changed time (FR-018a, US3-4)", async () => {
      await loadExample(prisma, "fill");
      const changed = await prisma.task.update({ where: { id: WALLS }, data: { approvedProgress: 55 } });

      await loadExample(prisma, "fill");

      const after = await prisma.task.findUniqueOrThrow({ where: { id: WALLS } });
      expect(after.approvedProgress).toBe(55);
      expect(after.updatedAt).toEqual(changed.updatedAt);
    });

    it("lists the loaded tasks in PRD order", async () => {
      await loadExample(prisma, "fill");

      const worksite = await new PrismaWorksiteRepository(prisma).findById(toWorksiteId(TOWNHOUSE));

      expect(worksite?.tasks.map((task) => task.name)).toEqual([
        "Pour foundation",
        "Build ground-floor walls",
        "Install electrical",
      ]);
    });
  });

  describe("reset", () => {
    it("sets changed example rows back to the PRD values (FR-018b, US3-5)", async () => {
      await insertExampleLongAgo();
      await prisma.task.update({ where: { id: WALLS }, data: { approvedProgress: 55 } });
      await prisma.user.update({ where: { id: MARK }, data: { name: "Marcus" } });

      await loadExample(prisma, "reset");

      const walls = await prisma.task.findUniqueOrThrow({ where: { id: WALLS } });
      expect(walls.approvedProgress).toBe(40);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: MARK } })).name).toBe("Mark");
      expect(await counts()).toEqual([3, 1, 3]);
    });

    it("advances the last-changed time and keeps the creation time (FR-015a, FR-018b)", async () => {
      await insertExampleLongAgo();

      await loadExample(prisma, "reset");

      const walls = await prisma.task.findUniqueOrThrow({ where: { id: WALLS } });
      expect(walls.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
      expect(walls.createdAt).toEqual(LONG_AGO);
    });

    it("inserts missing example rows", async () => {
      await loadExample(prisma, "reset");

      expect(await counts()).toEqual([3, 1, 3]);
    });
  });

  it.each(["fill", "reset"] as const)("%s leaves rows outside the example untouched (FR-018)", async (mode) => {
    await loadExample(prisma, "fill");
    const other = await insertWorksite(prisma, { name: "Other site", createdAt: LONG_AGO, updatedAt: LONG_AGO });
    const otherTask = await insertTask(prisma, {
      worksiteId: other.id,
      assigneeId: MARK,
      approvedProgress: 70,
      createdAt: LONG_AGO,
      updatedAt: LONG_AGO,
    });

    await loadExample(prisma, mode);

    expect(await prisma.worksite.findUniqueOrThrow({ where: { id: other.id } })).toEqual(other);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: otherTask.id } })).toEqual(otherTask);
  });
});
