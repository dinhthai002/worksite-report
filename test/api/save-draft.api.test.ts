import { createPrismaClient } from "@src/shared/infrastructure/db";
import request from "supertest";
import { loadExample } from "../../prisma/seed";
import { insertReport, insertTask, insertUser, insertWorksite, truncateAll } from "../support/database";
import { createTestApp } from "../support/test-app";
import {
  Caller,
  ELECTRICAL,
  FOREMAN,
  LINDA,
  MARK,
  type SaveBody,
  SITE_SUPERVISOR,
  TOWNHOUSE,
  WALLS,
} from "../support/townhouse";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is not set. API tests must run through Jest, which starts PostgreSQL.");
}

const NOV_20 = "2026-11-20";
const WALLS_55: SaveBody = { items: [{ taskId: WALLS, reportedProgress: 55 }] };

describe("PUT /worksites/:worksiteId/reports/:workDate", () => {
  const prisma = createPrismaClient(databaseUrl);
  const app = createTestApp(prisma);
  const mark = new Caller(app, MARK, FOREMAN);
  const linda = new Caller(app, LINDA, SITE_SUPERVISOR);

  beforeEach(async () => {
    await truncateAll(prisma);
    await loadExample(prisma, "fill");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function storedReports(): Promise<{ version: number; note: string | null; items: number[] }[]> {
    const rows = await prisma.dailyReport.findMany({ include: { items: true } });
    return rows.map((row) => ({
      version: row.version,
      note: row.note,
      items: row.items.map((item) => item.reportedProgress),
    }));
  }

  it("creates a draft: 201 with version 1", async () => {
    const response = await mark.saveDraft(TOWNHOUSE, NOV_20, { ...WALLS_55, note: "Rain from 15:00." });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      worksiteId: TOWNHOUSE,
      authorId: MARK,
      workDate: NOV_20,
      status: "DRAFT",
      version: 1,
      note: "Rain from 15:00.",
      items: [{ taskId: WALLS, reportedProgress: 55, note: null }],
      transitions: [],
    });
  });

  it("edits with the current version: 200 with version 2", async () => {
    await mark.saveDraft(TOWNHOUSE, NOV_20, WALLS_55);

    const response = await mark.saveDraft(TOWNHOUSE, NOV_20, {
      version: 1,
      items: [{ taskId: WALLS, reportedProgress: 60, note: "Lintels in." }],
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({ version: 2, items: [{ taskId: WALLS, reportedProgress: 60, note: "Lintels in." }] }),
    );
  });

  it("BR-1 a first save when the report exists returns it unchanged with 200", async () => {
    const first = await mark.saveDraft(TOWNHOUSE, NOV_20, WALLS_55);

    const again = await mark.saveDraft(TOWNHOUSE, NOV_20, { items: [{ taskId: WALLS, reportedProgress: 70 }] });

    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await storedReports()).toEqual([{ version: 1, note: null, items: [55] }]);
  });

  it.each([
    ["a date that does not exist", TOWNHOUSE, "2026-02-30", WALLS_55, "params.workDate"],
    ["a worksite ID that is not a UUID", "townhouse", NOV_20, WALLS_55, "params.worksiteId"],
    [
      "progress that is not a whole number",
      TOWNHOUSE,
      NOV_20,
      { items: [{ taskId: WALLS, reportedProgress: 55.5 }] },
      "body.items.0.reportedProgress",
    ],
    ["a report note of 2,001 characters", TOWNHOUSE, NOV_20, { ...WALLS_55, note: "x".repeat(2001) }, "body.note"],
    ["an unknown body field", TOWNHOUSE, NOV_20, { ...WALLS_55, status: "SUBMITTED" }, "body"],
  ])("400 for %s", async (_case, worksiteId, workDate, body, path) => {
    const response = await mark.saveDraft(worksiteId, workDate, body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.issues.map((issue: { path: string }) => issue.path)).toContain(path);
  });

  it("400 for an item note of 2,001 characters, naming the task", async () => {
    const response = await mark.saveDraft(TOWNHOUSE, NOV_20, {
      items: [{ taskId: WALLS, reportedProgress: 55, note: "x".repeat(2001) }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details.issues).toEqual([
      { path: "body.items.0.note", message: `The note for task ${WALLS} is longer than 2000 characters.` },
    ]);
  });

  it("404 WORKSITE_NOT_FOUND for an unknown worksite", async () => {
    const response = await mark.saveDraft("00000000-0000-4000-8000-000000000999", NOV_20, WALLS_55);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("WORKSITE_NOT_FOUND");
  });

  it.each([
    ["2026-11-22", "the day after today"],
    ["2025-11-20", "366 days before today"],
  ])("BR-2 422 WORK_DATE_OUT_OF_RANGE for %s (%s)", async (workDate) => {
    const response = await mark.saveDraft(TOWNHOUSE, workDate, WALLS_55);

    expect(response.status).toBe(422);
    expect(response.body.error).toEqual(
      expect.objectContaining({
        code: "WORK_DATE_OUT_OF_RANGE",
        details: { workDate, earliest: "2025-11-21", latest: "2026-11-21" },
      }),
    );
  });

  it("BR-3 422 WORKSITE_CLOSED for a closed worksite", async () => {
    const closed = await insertWorksite(prisma, { status: "CLOSED", supervisorId: LINDA });
    const task = await insertTask(prisma, { worksiteId: closed.id, assigneeId: MARK });

    const response = await mark.saveDraft(closed.id, NOV_20, { items: [{ taskId: task.id, reportedProgress: 10 }] });

    expect(response.status).toBe(422);
    expect(response.body.error).toEqual(expect.objectContaining({ code: "WORKSITE_CLOSED" }));
  });

  it("BR-4 422 TASK_LISTED_TWICE for a duplicated task", async () => {
    const response = await mark.saveDraft(TOWNHOUSE, NOV_20, {
      items: [
        { taskId: WALLS, reportedProgress: 55 },
        { taskId: WALLS, reportedProgress: 60 },
      ],
    });

    expect(response.status).toBe(422);
    expect(response.body.error).toEqual(
      expect.objectContaining({ code: "TASK_LISTED_TWICE", details: { taskId: WALLS } }),
    );
  });

  it("BR-4 422 TASK_NOT_IN_WORKSITE for a task of another worksite", async () => {
    const other = await insertWorksite(prisma, { supervisorId: LINDA });
    const task = await insertTask(prisma, { worksiteId: other.id, assigneeId: MARK });

    const response = await mark.saveDraft(TOWNHOUSE, NOV_20, { items: [{ taskId: task.id, reportedProgress: 10 }] });

    expect(response.status).toBe(422);
    expect(response.body.error).toEqual(
      expect.objectContaining({ code: "TASK_NOT_IN_WORKSITE", details: { taskId: task.id, worksiteId: TOWNHOUSE } }),
    );
  });

  it("BR-4 422 TASK_NOT_ASSIGNED_TO_AUTHOR for another foreman's task", async () => {
    const response = await mark.saveDraft(TOWNHOUSE, NOV_20, { items: [{ taskId: ELECTRICAL, reportedProgress: 10 }] });

    expect(response.status).toBe(422);
    expect(response.body.error).toEqual(
      expect.objectContaining({
        code: "TASK_NOT_ASSIGNED_TO_AUTHOR",
        details: { taskId: ELECTRICAL, taskName: "Install electrical" },
      }),
    );
  });

  it("BR-5 422 PROGRESS_OUT_OF_RANGE for progress 101", async () => {
    const response = await mark.saveDraft(TOWNHOUSE, NOV_20, { items: [{ taskId: WALLS, reportedProgress: 101 }] });

    expect(response.status).toBe(422);
    expect(response.body.error).toEqual(
      expect.objectContaining({
        code: "PROGRESS_OUT_OF_RANGE",
        details: { taskId: WALLS, reportedProgress: 101, min: 0, max: 100 },
      }),
    );
  });

  it("BR-6 409 REPORT_NOT_EDITABLE for a SUBMITTED report", async () => {
    await insertReport(prisma, { worksiteId: TOWNHOUSE, authorId: MARK, workDate: NOV_20, status: "SUBMITTED" });

    const response = await mark.saveDraft(TOWNHOUSE, NOV_20, { version: 1, ...WALLS_55 });

    expect(response.status).toBe(409);
    expect(response.body.error).toEqual(
      expect.objectContaining({ code: "REPORT_NOT_EDITABLE", details: { status: "SUBMITTED" } }),
    );
  });

  it("403 ROLE_CANNOT_AUTHOR_REPORTS for a site supervisor", async () => {
    const response = await linda.saveDraft(TOWNHOUSE, NOV_20, WALLS_55);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ROLE_CANNOT_AUTHOR_REPORTS");
  });

  it("a refused save changes nothing", async () => {
    await mark.saveDraft(TOWNHOUSE, NOV_20, WALLS_55);

    await mark.saveDraft(TOWNHOUSE, NOV_20, {
      version: 1,
      note: "x",
      items: [{ taskId: ELECTRICAL, reportedProgress: 10 }],
    });

    expect(await storedReports()).toEqual([{ version: 1, note: null, items: [55] }]);
  });

  it("401 UNAUTHENTICATED with no actor headers", async () => {
    const response = await request(app)
      .put(`/worksites/${TOWNHOUSE}/reports/${NOV_20}`)
      .set("Idempotency-Key", "k-401")
      .send(WALLS_55);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("401 does not claim the request key: the same key with valid headers then succeeds", async () => {
    await request(app).put(`/worksites/${TOWNHOUSE}/reports/${NOV_20}`).set("Idempotency-Key", "k-401").send(WALLS_55);

    const response = await mark.saveDraft(TOWNHOUSE, NOV_20, WALLS_55, "k-401");

    expect(response.status).toBe(201);
  });

  it("another foreman saving for the same worksite and date creates their own report", async () => {
    const other = await insertUser(prisma);
    await insertTask(prisma, { worksiteId: TOWNHOUSE, assigneeId: other.id });
    await mark.saveDraft(TOWNHOUSE, NOV_20, WALLS_55);

    const response = await new Caller(app, other.id, FOREMAN).saveDraft(TOWNHOUSE, NOV_20, { items: [] });

    expect(response.status).toBe(201);
    expect(response.body.authorId).toBe(other.id);
  });
});
