import { createPrismaClient } from "@src/shared/infrastructure/db";
import request from "supertest";
import { loadExample } from "../../prisma/seed";
import { insertUser, insertWorksite, truncateAll } from "../support/database";
import { createTestApp } from "../support/test-app";
import {
  Caller,
  FOREMAN,
  FOUNDATION,
  HENRY,
  LINDA,
  MARK,
  SITE_SUPERVISOR,
  TOWNHOUSE,
  WALLS,
} from "../support/townhouse";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is not set. API tests must run through Jest, which starts PostgreSQL.");
}

const NOV_20 = "2026-11-20";

/** GET /reports/:reportId (contracts/get-report.md; spec US4; UC-5; FR-030 to FR-033). */
describe("GET /reports/:reportId", () => {
  const prisma = createPrismaClient(databaseUrl);
  const app = createTestApp(prisma);
  const mark = new Caller(app, MARK, FOREMAN);
  const henry = new Caller(app, HENRY, FOREMAN);
  const linda = new Caller(app, LINDA, SITE_SUPERVISOR);

  beforeEach(async () => {
    await truncateAll(prisma);
    await loadExample(prisma, "fill");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function marksDraft(): Promise<string> {
    const draft = await mark.saveDraft(TOWNHOUSE, NOV_20, {
      note: "Rain from 15:00.",
      items: [
        { taskId: WALLS, reportedProgress: 55, note: "East wall done." },
        { taskId: FOUNDATION, reportedProgress: 100 },
      ],
    });
    expect(draft.status).toBe(201);
    return draft.body.id;
  }

  async function marksSubmittedReport(): Promise<string> {
    const id = await marksDraft();
    const submitted = await mark.submit(id, { version: 1 });
    expect(submitted.status).toBe(200);
    return id;
  }

  it("returns the report, its items, its transitions and its version to the author", async () => {
    const id = await marksSubmittedReport();

    const response = await mark.getReport(id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        id,
        worksiteId: TOWNHOUSE,
        authorId: MARK,
        workDate: NOV_20,
        status: "SUBMITTED",
        version: 2,
        note: "Rain from 15:00.",
      }),
    );
    expect(response.body.items).toHaveLength(2);
    expect(response.body.items).toEqual(
      expect.arrayContaining([{ taskId: WALLS, reportedProgress: 55, note: "East wall done." }]),
    );
    expect(response.body.transitions).toEqual([
      {
        fromStatus: "DRAFT",
        toStatus: "SUBMITTED",
        actorId: MARK,
        occurredAt: expect.stringMatching(/Z$/),
        reason: null,
      },
    ]);
  });

  it("shows a draft to its author with no transitions", async () => {
    const id = await marksDraft();

    const response = await mark.getReport(id);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("DRAFT");
    expect(response.body.transitions).toEqual([]);
  });

  it("FR-030 shows a submitted report to the worksite's site supervisor", async () => {
    const id = await marksSubmittedReport();

    const response = await linda.getReport(id);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("SUBMITTED");
  });

  it("FR-030 refuses the worksite's site supervisor a draft", async () => {
    const id = await marksDraft();

    const response = await linda.getReport(id);

    expect(response.status).toBe(403);
    expect(response.body.error).toEqual(
      expect.objectContaining({ code: "REPORT_VIEW_FORBIDDEN", details: { reportId: id } }),
    );
  });

  it("FR-030 refuses another foreman", async () => {
    const id = await marksSubmittedReport();

    const response = await henry.getReport(id);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("REPORT_VIEW_FORBIDDEN");
  });

  it("FR-030 refuses the site supervisor of another worksite", async () => {
    const id = await marksSubmittedReport();
    const sam = await insertUser(prisma, { role: "SITE_SUPERVISOR" });
    await insertWorksite(prisma, { supervisorId: sam.id });

    const response = await new Caller(app, sam.id, SITE_SUPERVISOR).getReport(id);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("REPORT_VIEW_FORBIDDEN");
  });

  it("refuses an unknown report as not found", async () => {
    const unknown = "00000000-0000-4000-8000-00000000ffff";

    const response = await mark.getReport(unknown);

    expect(response.status).toBe(404);
    expect(response.body.error).toEqual(
      expect.objectContaining({ code: "REPORT_NOT_FOUND", details: { reportId: unknown } }),
    );
  });

  it("refuses a report ID that is not a UUID", async () => {
    const response = await mark.getReport("not-a-uuid");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a query parameter", async () => {
    const id = await marksDraft();

    const response = await mark.getReport(id).query({ include: "everything" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a non-empty body", async () => {
    const id = await marksDraft();

    const response = await mark.getReport(id).send({ version: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("FR-033 changes nothing: version and updated_at are the same after viewing", async () => {
    const id = await marksSubmittedReport();
    const before = await prisma.dailyReport.findUniqueOrThrow({ where: { id } });

    await mark.getReport(id);
    await linda.getReport(id);

    const after = await prisma.dailyReport.findUniqueOrThrow({ where: { id } });
    expect(after.version).toBe(before.version);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("refuses a request without actor headers as unauthenticated", async () => {
    const id = await marksDraft();

    const response = await request(app).get(`/reports/${id}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
});
