import { createPrismaClient } from "@src/shared/infrastructure/db";
import request from "supertest";
import { loadExample } from "../../prisma/seed";
import { insertReport, insertReportItem, insertTransition, truncateAll } from "../support/database";
import { createTestApp } from "../support/test-app";
import { Caller, FOREMAN, HENRY, LINDA, MARK, TOWNHOUSE, WALLS } from "../support/townhouse";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is not set. API tests must run through Jest, which starts PostgreSQL.");
}

const NOV_20 = "2026-11-20";

describe("POST /reports/:reportId/submit", () => {
  const prisma = createPrismaClient(databaseUrl);
  const app = createTestApp(prisma);
  const mark = new Caller(app, MARK, FOREMAN);

  beforeEach(async () => {
    await truncateAll(prisma);
    await loadExample(prisma, "fill");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function draftWalls(progress: number): Promise<string> {
    const response = await mark.saveDraft(TOWNHOUSE, NOV_20, {
      items: [{ taskId: WALLS, reportedProgress: progress }],
    });
    return response.body.id as string;
  }

  async function wallsApprovedProgress(): Promise<number> {
    return (await prisma.task.findUniqueOrThrow({ where: { id: WALLS } })).approvedProgress;
  }

  it("200 with SUBMITTED, the version increased and one transition", async () => {
    const reportId = await draftWalls(55);

    const response = await mark.submit(reportId, { version: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        status: "SUBMITTED",
        version: 2,
        items: [{ taskId: WALLS, reportedProgress: 55, note: null }],
        transitions: [
          {
            fromStatus: "DRAFT",
            toStatus: "SUBMITTED",
            actorId: MARK,
            occurredAt: "2026-11-21T03:00:00.000Z",
            reason: null,
          },
        ],
      }),
    );
    expect(await wallsApprovedProgress()).toBe(40);
  });

  it("200 from REJECTED, recording a REJECTED to SUBMITTED transition", async () => {
    const report = await insertReport(prisma, {
      worksiteId: TOWNHOUSE,
      authorId: MARK,
      status: "REJECTED",
      version: 3,
    });
    await insertReportItem(prisma, { reportId: report.id, taskId: WALLS, reportedProgress: 50 });
    await insertTransition(prisma, { reportId: report.id, actorId: MARK });
    await insertTransition(prisma, {
      reportId: report.id,
      actorId: LINDA,
      fromStatus: "SUBMITTED",
      toStatus: "REJECTED",
      occurredAt: new Date("2026-11-20T12:00:00Z"),
      reason: "Walls not plumb.",
    });

    const response = await mark.submit(report.id, { version: 3 });

    expect(response.status).toBe(200);
    expect(
      response.body.transitions.map((t: { fromStatus: string; toStatus: string }) => [t.fromStatus, t.toStatus]),
    ).toEqual([
      ["DRAFT", "SUBMITTED"],
      ["SUBMITTED", "REJECTED"],
      ["REJECTED", "SUBMITTED"],
    ]);
  });

  it.each([
    ["a missing version", {}],
    ["a version that is not an integer", { version: "1" }],
  ])("400 for %s", async (_case, body) => {
    const reportId = await draftWalls(55);

    const response = await mark.submit(reportId, body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("400 for a report ID that is not a UUID", async () => {
    const response = await mark.submit("not-a-uuid", { version: 1 });

    expect(response.status).toBe(400);
  });

  it("404 REPORT_NOT_FOUND for an unknown report", async () => {
    const response = await mark.submit("00000000-0000-4000-8000-000000000999", { version: 1 });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("REPORT_NOT_FOUND");
  });

  it("BR-15 409 REPORT_VERSION_CONFLICT for a stale version, giving the current version", async () => {
    const reportId = await draftWalls(55);
    await mark.saveDraft(TOWNHOUSE, NOV_20, { version: 1, items: [{ taskId: WALLS, reportedProgress: 60 }] });

    const response = await mark.submit(reportId, { version: 1 });

    expect(response.status).toBe(409);
    expect(response.body.error).toEqual(
      expect.objectContaining({ code: "REPORT_VERSION_CONFLICT", details: { expectedVersion: 1, currentVersion: 2 } }),
    );
  });

  it("409 INVALID_STATUS_TRANSITION for a SUBMITTED report", async () => {
    const reportId = await draftWalls(55);
    await mark.submit(reportId, { version: 1 });

    const response = await mark.submit(reportId, { version: 2 });

    expect(response.status).toBe(409);
    expect(response.body.error).toEqual(
      expect.objectContaining({
        code: "INVALID_STATUS_TRANSITION",
        message: "A SUBMITTED report cannot be submitted. Only a DRAFT or REJECTED report can be.",
      }),
    );
  });

  it("BR-7 422 REPORT_HAS_NO_ITEMS", async () => {
    const response = await mark.saveDraft(TOWNHOUSE, NOV_20, { items: [] });

    const submitted = await mark.submit(response.body.id, { version: 1 });

    expect(submitted.status).toBe(422);
    expect(submitted.body.error.code).toBe("REPORT_HAS_NO_ITEMS");
  });

  it("BR-5 422 PROGRESS_BELOW_APPROVED", async () => {
    const reportId = await draftWalls(30);

    const response = await mark.submit(reportId, { version: 1 });

    expect(response.status).toBe(422);
    expect(response.body.error).toEqual(
      expect.objectContaining({
        code: "PROGRESS_BELOW_APPROVED",
        details: { taskId: WALLS, taskName: "Build ground-floor walls", reportedProgress: 30, approvedProgress: 40 },
      }),
    );
  });

  it("BR-3 422 WORKSITE_CLOSED when the worksite is closed after the save", async () => {
    const reportId = await draftWalls(55);
    await prisma.worksite.update({ where: { id: TOWNHOUSE }, data: { status: "CLOSED" } });

    const response = await mark.submit(reportId, { version: 1 });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("WORKSITE_CLOSED");
  });

  it("BR-4 422 TASK_NOT_ASSIGNED_TO_AUTHOR when the task is reassigned after the save", async () => {
    const reportId = await draftWalls(55);
    await prisma.task.update({ where: { id: WALLS }, data: { assigneeId: HENRY } });

    const response = await mark.submit(reportId, { version: 1 });

    expect(response.status).toBe(422);
    expect(response.body.error).toEqual(
      expect.objectContaining({
        code: "TASK_NOT_ASSIGNED_TO_AUTHOR",
        details: expect.objectContaining({ taskId: WALLS }),
      }),
    );
  });

  it("a refused submission leaves the report and approved progress unchanged", async () => {
    const reportId = await draftWalls(30);

    await mark.submit(reportId, { version: 1 });

    const stored = await prisma.dailyReport.findUniqueOrThrow({
      where: { id: reportId },
      include: { transitions: true },
    });
    expect([stored.status, stored.version, stored.transitions.length]).toEqual(["DRAFT", 1, 0]);
    expect(await wallsApprovedProgress()).toBe(40);
  });

  it("401 UNAUTHENTICATED with no actor headers", async () => {
    const reportId = await draftWalls(55);

    const response = await request(app)
      .post(`/reports/${reportId}/submit`)
      .set("Idempotency-Key", "k-401")
      .send({ version: 1 });

    expect(response.status).toBe(401);
  });
});
