import { toWorksiteId } from "@src/modules/worksite/domain/worksite";
import { PrismaWorksiteRepository } from "@src/modules/worksite/infrastructure/prisma-worksite.repository";
import { toUserId } from "@src/shared/domain/actor";
import { createPrismaClient } from "@src/shared/infrastructure/db";
import { insertTask, insertUser, insertWorksite, truncateAll } from "../support/database";
import { aTask, aWorksite } from "../support/worksite.builder";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is not set. Integration tests must run through Jest, which starts PostgreSQL.");
}

const SUPERVISOR_ID = "00000000-0000-4000-8000-000000000001";
const FOREMAN_ID = "00000000-0000-4000-8000-000000000002";
const WORKSITE_ID = "00000000-0000-4000-8000-000000000101";
const TASK_A = "00000000-0000-4000-8000-000000000201";
const TASK_B = "00000000-0000-4000-8000-000000000202";
const TASK_C = "00000000-0000-4000-8000-000000000203";

function at(day: number): Date {
  return new Date(Date.UTC(2026, 10, day));
}

describe("PrismaWorksiteRepository", () => {
  const prisma = createPrismaClient(databaseUrl);
  const repository = new PrismaWorksiteRepository(prisma);

  beforeEach(async () => {
    await truncateAll(prisma);
    await insertUser(prisma, { id: SUPERVISOR_ID, name: "Linda", role: "SITE_SUPERVISOR" });
    await insertUser(prisma, { id: FOREMAN_ID, name: "Mark", role: "FOREMAN" });
    await insertWorksite(prisma, { id: WORKSITE_ID, name: "Three-storey townhouse", supervisorId: SUPERVISOR_ID });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function insertTasks(times: readonly { id: string; createdAt: Date; updatedAt: Date }[]): Promise<void> {
    for (const time of times) {
      await insertTask(prisma, { ...time, worksiteId: WORKSITE_ID, assigneeId: FOREMAN_ID, name: time.id });
    }
  }

  async function loadedTaskIds(): Promise<string[]> {
    const worksite = await repository.findById(toWorksiteId(WORKSITE_ID));
    return worksite === undefined ? [] : worksite.tasks.map((task) => task.id);
  }

  it("loads stored rows back as the expected worksite (round trip)", async () => {
    await insertTask(prisma, {
      id: TASK_B,
      worksiteId: WORKSITE_ID,
      name: "Build ground-floor walls",
      assigneeId: FOREMAN_ID,
      approvedProgress: 40,
    });

    const loaded = await repository.findById(toWorksiteId(WORKSITE_ID));

    const expected = aWorksite()
      .withId(WORKSITE_ID)
      .supervisedBy(toUserId(SUPERVISOR_ID))
      .withTasks(
        aTask()
          .withId(TASK_B)
          .named("Build ground-floor walls")
          .assignedTo(toUserId(FOREMAN_ID))
          .withApprovedProgress(40)
          .build(),
      )
      .build();
    expect(loaded).toEqual(expected);
  });

  it("loads a closed worksite with its status", async () => {
    await prisma.worksite.update({ where: { id: WORKSITE_ID }, data: { status: "CLOSED" } });

    const loaded = await repository.findById(toWorksiteId(WORKSITE_ID));

    expect(loaded?.status).toBe("CLOSED");
  });

  it("returns undefined for an unknown ID", async () => {
    expect(await repository.findById(toWorksiteId("00000000-0000-4000-8000-000000000999"))).toBeUndefined();
  });

  describe("task order (FR-010)", () => {
    it("lists the most recently changed task first", async () => {
      await insertTasks([
        { id: TASK_A, createdAt: at(1), updatedAt: at(1) },
        { id: TASK_B, createdAt: at(1), updatedAt: at(3) },
        { id: TASK_C, createdAt: at(1), updatedAt: at(2) },
      ]);

      expect(await loadedTaskIds()).toEqual([TASK_B, TASK_C, TASK_A]);
    });

    it("breaks a tie in last-changed time by creation time, oldest first", async () => {
      await insertTasks([
        { id: TASK_A, createdAt: at(3), updatedAt: at(5) },
        { id: TASK_B, createdAt: at(1), updatedAt: at(5) },
        { id: TASK_C, createdAt: at(2), updatedAt: at(5) },
      ]);

      expect(await loadedTaskIds()).toEqual([TASK_B, TASK_C, TASK_A]);
    });

    it("breaks a tie in both times by ID", async () => {
      await insertTasks([
        { id: TASK_C, createdAt: at(1), updatedAt: at(1) },
        { id: TASK_A, createdAt: at(1), updatedAt: at(1) },
        { id: TASK_B, createdAt: at(1), updatedAt: at(1) },
      ]);

      expect(await loadedTaskIds()).toEqual([TASK_A, TASK_B, TASK_C]);
    });

    it("moves a task that changes to the top", async () => {
      await insertTasks([
        { id: TASK_A, createdAt: at(1), updatedAt: at(1) },
        { id: TASK_B, createdAt: at(1), updatedAt: at(1) },
        { id: TASK_C, createdAt: at(1), updatedAt: at(1) },
      ]);

      await prisma.task.update({ where: { id: TASK_B }, data: { approvedProgress: 55 } });

      expect(await loadedTaskIds()).toEqual([TASK_B, TASK_A, TASK_C]);
    });
  });
});
