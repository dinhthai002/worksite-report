import { createPrismaClient } from "@src/shared/infrastructure/db";
import request from "supertest";
import { insertTask, insertUser, insertWorksite, truncateAll } from "../support/database";
import { createTestApp } from "../support/test-app";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is not set. API tests must run through Jest, which starts PostgreSQL.");
}

// The PRD example's fixed IDs (data-model.md section 4).
const LINDA = "00000000-0000-4000-8000-000000000001";
const MARK = "00000000-0000-4000-8000-000000000002";
const HENRY = "00000000-0000-4000-8000-000000000003";
const OTHER_FOREMAN = "00000000-0000-4000-8000-000000000004";
const TOWNHOUSE = "00000000-0000-4000-8000-000000000101";
const EMPTY_SITE = "00000000-0000-4000-8000-000000000102";
const FOUNDATION = "00000000-0000-4000-8000-000000000201";
const WALLS = "00000000-0000-4000-8000-000000000202";
const ELECTRICAL = "00000000-0000-4000-8000-000000000203";

// Same times for the three tasks, as the seed writes them in one transaction, so the ID tie-break gives PRD order.
const WRITTEN_AT = new Date("2026-11-20T00:00:00Z");

describe("GET /worksites/:worksiteId", () => {
  const prisma = createPrismaClient(databaseUrl);
  const app = createTestApp(prisma);

  function viewAs(userId: string, role: string, path: string): request.Test {
    return request(app).get(path).set("X-Actor-Id", userId).set("X-Actor-Role", role);
  }

  beforeEach(async () => {
    await truncateAll(prisma);
    await insertUser(prisma, { id: LINDA, name: "Linda", role: "SITE_SUPERVISOR" });
    await insertUser(prisma, { id: MARK, name: "Mark", role: "FOREMAN" });
    await insertUser(prisma, { id: HENRY, name: "Henry", role: "FOREMAN" });
    await insertUser(prisma, { id: OTHER_FOREMAN, name: "Other foreman", role: "FOREMAN" });
    await insertWorksite(prisma, { id: TOWNHOUSE, name: "Three-storey townhouse", supervisorId: LINDA });
    const times = { createdAt: WRITTEN_AT, updatedAt: WRITTEN_AT };
    await insertTask(prisma, {
      id: FOUNDATION,
      worksiteId: TOWNHOUSE,
      name: "Pour foundation",
      assigneeId: MARK,
      approvedProgress: 100,
      ...times,
    });
    await insertTask(prisma, {
      id: WALLS,
      worksiteId: TOWNHOUSE,
      name: "Build ground-floor walls",
      assigneeId: MARK,
      approvedProgress: 40,
      ...times,
    });
    await insertTask(prisma, {
      id: ELECTRICAL,
      worksiteId: TOWNHOUSE,
      name: "Install electrical",
      assigneeId: HENRY,
      approvedProgress: 0,
      ...times,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("gives Linda the worksite and its three tasks in PRD order (US1-1, SC-001)", async () => {
    const response = await viewAs(LINDA, "SITE_SUPERVISOR", `/worksites/${TOWNHOUSE}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: TOWNHOUSE,
      name: "Three-storey townhouse",
      status: "ACTIVE",
      supervisorId: LINDA,
      tasks: [
        { id: FOUNDATION, name: "Pour foundation", assigneeId: MARK, approvedProgress: 100 },
        { id: WALLS, name: "Build ground-floor walls", assigneeId: MARK, approvedProgress: 40 },
        { id: ELECTRICAL, name: "Install electrical", assigneeId: HENRY, approvedProgress: 0 },
      ],
    });
  });

  it("gives Mark only his two tasks (US1-2, SC-002)", async () => {
    const response = await viewAs(MARK, "FOREMAN", `/worksites/${TOWNHOUSE}`);

    expect(response.status).toBe(200);
    expect(response.body.supervisorId).toBe(LINDA);
    expect(response.body.tasks.map((task: { id: string }) => task.id)).toEqual([FOUNDATION, WALLS]);
  });

  it("gives Henry only his one task (US1-3, SC-002)", async () => {
    const response = await viewAs(HENRY, "FOREMAN", `/worksites/${TOWNHOUSE}`);

    expect(response.status).toBe(200);
    expect(response.body.tasks).toEqual([
      { id: ELECTRICAL, name: "Install electrical", assigneeId: HENRY, approvedProgress: 0 },
    ]);
  });

  it("gives a foreman with no tasks in the worksite an empty task list (US1-4)", async () => {
    const response = await viewAs(OTHER_FOREMAN, "FOREMAN", `/worksites/${TOWNHOUSE}`);

    expect(response.status).toBe(200);
    expect(response.body.tasks).toEqual([]);
  });

  it("gives an empty task list for a worksite with no tasks (US1-6)", async () => {
    await insertWorksite(prisma, { id: EMPTY_SITE, name: "Empty site", supervisorId: LINDA });

    const response = await viewAs(LINDA, "SITE_SUPERVISOR", `/worksites/${EMPTY_SITE}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: EMPTY_SITE, tasks: [] });
  });

  it("lists a task that changed first (US1-7, FR-010)", async () => {
    await prisma.task.update({ where: { id: WALLS }, data: { approvedProgress: 55 } });

    const response = await viewAs(LINDA, "SITE_SUPERVISOR", `/worksites/${TOWNHOUSE}`);

    expect(response.body.tasks.map((task: { id: string }) => task.id)).toEqual([WALLS, FOUNDATION, ELECTRICAL]);
  });

  it("changes no data (FR-012)", async () => {
    const before = await prisma.task.findMany({ orderBy: { id: "asc" } });

    await viewAs(LINDA, "SITE_SUPERVISOR", `/worksites/${TOWNHOUSE}`);

    expect(await prisma.task.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });

  it("returns 404 WORKSITE_NOT_FOUND naming an unknown ID (US1-5)", async () => {
    const unknown = "00000000-0000-4000-8000-000000000999";

    const response = await viewAs(LINDA, "SITE_SUPERVISOR", `/worksites/${unknown}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "WORKSITE_NOT_FOUND",
        message: `There is no worksite with ID ${unknown}.`,
        details: { worksiteId: unknown },
      },
    });
  });

  it("returns 400 for an ID that is not a UUID", async () => {
    const response = await viewAs(LINDA, "SITE_SUPERVISOR", "/worksites/not-a-uuid");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: "VALIDATION_FAILED", message: expect.any(String) });
    expect(response.body.error.details.issues).toEqual([{ path: "params.worksiteId", message: expect.any(String) }]);
  });

  it("returns 400 for a query parameter (API-01)", async () => {
    const response = await viewAs(LINDA, "SITE_SUPERVISOR", `/worksites/${TOWNHOUSE}?foo=1`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.issues).toEqual([{ path: "query", message: expect.stringContaining("foo") }]);
  });

  it("returns 400 for a non-empty body (API-01)", async () => {
    const response = await viewAs(LINDA, "SITE_SUPERVISOR", `/worksites/${TOWNHOUSE}`).send({ approvedProgress: 100 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.issues).toEqual([{ path: "body", message: expect.any(String) }]);
  });
});
