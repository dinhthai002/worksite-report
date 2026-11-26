import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@src/shared/infrastructure/db";
import { insertTask, insertUser, insertWorksite, truncateAll } from "../support/database";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is not set. Integration tests must run through Jest, which starts PostgreSQL.");
}

const LONG_AGO = new Date("2000-01-01T00:00:00Z");

describe("database schema", () => {
  const prisma = createPrismaClient(databaseUrl);

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("tasks.approved_progress (FR-015)", () => {
    it.each([-1, 101])("rejects %i with the range constraint", async (approvedProgress) => {
      await expect(insertTask(prisma, { approvedProgress })).rejects.toThrow(/tasks_approved_progress_range/);
    });

    it.each([0, 100])("accepts %i", async (approvedProgress) => {
      const task = await insertTask(prisma, { approvedProgress });

      expect(task.approvedProgress).toBe(approvedProgress);
    });

    it("starts at 0 when not given", async () => {
      const task = await insertTask(prisma);

      expect(task.approvedProgress).toBe(0);
    });
  });

  describe("worksites.status (FR-013)", () => {
    it("starts as ACTIVE when not given", async () => {
      const worksite = await insertWorksite(prisma);

      expect(worksite.status).toBe("ACTIVE");
    });

    it("rejects a value outside ACTIVE and CLOSED", async () => {
      const supervisor = await insertUser(prisma, { role: "SITE_SUPERVISOR" });

      await expect(
        prisma.$queryRaw`
          INSERT INTO worksites (id, name, supervisor_id, status)
          VALUES (${randomUUID()}::uuid, 'Site', ${supervisor.id}::uuid, ${"PAUSED"}::worksite_status)`,
      ).rejects.toThrow(/worksite_status/);
    });
  });

  describe("users.role (FR-006)", () => {
    it("rejects a role outside FOREMAN and SITE_SUPERVISOR", async () => {
      await expect(
        prisma.$queryRaw`
          INSERT INTO users (id, name, role) VALUES (${randomUUID()}::uuid, 'Someone', ${"ADMIN"}::user_role)`,
      ).rejects.toThrow(/user_role/);
    });
  });

  describe("created_at and updated_at (FR-015a)", () => {
    it("advances users.updated_at on update and keeps created_at", async () => {
      const user = await insertUser(prisma, { createdAt: LONG_AGO, updatedAt: LONG_AGO });

      const updated = await prisma.user.update({ where: { id: user.id }, data: { name: "Renamed" } });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
      expect(updated.createdAt).toEqual(LONG_AGO);
    });

    it("advances worksites.updated_at on update and keeps created_at", async () => {
      const worksite = await insertWorksite(prisma, { createdAt: LONG_AGO, updatedAt: LONG_AGO });

      const updated = await prisma.worksite.update({ where: { id: worksite.id }, data: { name: "Renamed" } });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
      expect(updated.createdAt).toEqual(LONG_AGO);
    });

    it("advances tasks.updated_at on update and keeps created_at", async () => {
      const task = await insertTask(prisma, { createdAt: LONG_AGO, updatedAt: LONG_AGO });

      const updated = await prisma.task.update({ where: { id: task.id }, data: { approvedProgress: 10 } });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
      expect(updated.createdAt).toEqual(LONG_AGO);
    });
  });
});
