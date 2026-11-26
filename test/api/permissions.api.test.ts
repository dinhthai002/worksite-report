import { createPrismaClient } from "@src/shared/infrastructure/db";
import { loadExample } from "../../prisma/seed";
import { truncateAll } from "../support/database";
import { createTestApp } from "../support/test-app";
import {
  Caller,
  ELECTRICAL,
  FOREMAN,
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

/** Who may do what with a daily report (testing.md section 5; PRD, Roles; BR-4, BR-6). */
describe("report permissions", () => {
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

  it("a site supervisor cannot save a draft", async () => {
    const response = await linda.saveDraft(TOWNHOUSE, NOV_20, { items: [{ taskId: WALLS, reportedProgress: 55 }] });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ROLE_CANNOT_AUTHOR_REPORTS");
  });

  it("a site supervisor cannot submit a report", async () => {
    const draft = await mark.saveDraft(TOWNHOUSE, NOV_20, { items: [{ taskId: WALLS, reportedProgress: 55 }] });

    const response = await linda.submit(draft.body.id, { version: 1 });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ROLE_CANNOT_AUTHOR_REPORTS");
  });

  it("BR-4 a foreman cannot report on another foreman's task", async () => {
    const response = await mark.saveDraft(TOWNHOUSE, NOV_20, { items: [{ taskId: ELECTRICAL, reportedProgress: 10 }] });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("TASK_NOT_ASSIGNED_TO_AUTHOR");
  });

  it("BR-6 a foreman cannot submit another foreman's report", async () => {
    const draft = await mark.saveDraft(TOWNHOUSE, NOV_20, { items: [{ taskId: WALLS, reportedProgress: 55 }] });

    const response = await henry.submit(draft.body.id, { version: 1 });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("NOT_REPORT_AUTHOR");
  });
});
