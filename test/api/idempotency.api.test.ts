import { createPrismaClient } from "@src/shared/infrastructure/db";
import request from "supertest";
import { loadExample } from "../../prisma/seed";
import { truncateAll } from "../support/database";
import { createTestApp } from "../support/test-app";
import { Caller, FOREMAN, HENRY, MARK, type SaveBody, TOWNHOUSE, WALLS } from "../support/townhouse";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is not set. API tests must run through Jest, which starts PostgreSQL.");
}

const NOV_20 = "2026-11-20";
const WALLS_55: SaveBody = { items: [{ taskId: WALLS, reportedProgress: 55 }] };

/** BR-14, UC-1 acceptance and PRD implementation goal 1: safe retries (contracts/idempotency.md). */
describe("Idempotency-Key", () => {
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

  it("BR-14 five identical saves with one key yield one report and five identical responses", async () => {
    const responses = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      responses.push(await mark.saveDraft(TOWNHOUSE, NOV_20, WALLS_55, "save-1"));
    }

    expect(await prisma.dailyReport.count()).toBe(1);
    for (const response of responses) {
      expect([response.status, response.body]).toEqual([201, responses[0]?.body]);
    }
  });

  it("BR-14 a repeated submission returns the original response and records one transition", async () => {
    const draft = await mark.saveDraft(TOWNHOUSE, NOV_20, WALLS_55);
    const first = await mark.submit(draft.body.id, { version: 1 }, "submit-1");

    const again = await mark.submit(draft.body.id, { version: 1 }, "submit-1");

    expect([again.status, again.body]).toEqual([200, first.body]);
    expect(await prisma.reportTransition.count()).toBe(1);
  });

  it("BR-14 the same key with a different body is refused and changes nothing", async () => {
    await mark.saveDraft(TOWNHOUSE, NOV_20, WALLS_55, "save-1");

    const reused = await mark.saveDraft(TOWNHOUSE, NOV_20, { version: 1, ...WALLS_55, note: "changed" }, "save-1");

    expect(reused.status).toBe(422);
    expect(reused.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await prisma.dailyReport.findFirstOrThrow()).version).toBe(1);
  });

  it("400 VALIDATION_FAILED when the key is missing, and nothing is written", async () => {
    const response = await request(app)
      .put(`/worksites/${TOWNHOUSE}/reports/${NOV_20}`)
      .set("X-Actor-Id", MARK)
      .set("X-Actor-Role", FOREMAN)
      .send(WALLS_55);

    expect(response.status).toBe(400);
    expect(response.body.error.details.issues).toEqual([expect.objectContaining({ path: "headers.idempotency-key" })]);
    expect(await prisma.dailyReport.count()).toBe(0);
  });

  it("a refused request releases its key, so a retry with the same key runs again", async () => {
    const refused = await mark.saveDraft(TOWNHOUSE, "2026-11-22", WALLS_55, "save-1");
    expect(refused.status).toBe(422);

    const retried = await mark.saveDraft(TOWNHOUSE, "2026-11-22", WALLS_55, "save-1");

    expect(retried.status).toBe(422);
    expect(await prisma.idempotencyKey.count()).toBe(0);
  });

  it("BR-14 the same key value from two users does not interfere", async () => {
    await prisma.task.update({ where: { id: WALLS }, data: { assigneeId: MARK } });
    const henry = new Caller(app, HENRY, FOREMAN);
    await mark.saveDraft(TOWNHOUSE, NOV_20, WALLS_55, "shared-key");

    const henrys = await henry.saveDraft(TOWNHOUSE, NOV_20, { items: [] }, "shared-key");

    expect(henrys.status).toBe(201);
    expect(henrys.body.authorId).toBe(HENRY);
    expect(await prisma.dailyReport.count()).toBe(2);
  });

  it("BR-14 two concurrent identical requests with one key create one report", async () => {
    const outcomes = await Promise.allSettled([
      mark.saveDraft(TOWNHOUSE, NOV_20, WALLS_55, "race-1"),
      mark.saveDraft(TOWNHOUSE, NOV_20, WALLS_55, "race-1"),
    ]);
    const responses = outcomes.map((outcome) => {
      if (outcome.status === "rejected") {
        throw outcome.reason;
      }
      return outcome.value;
    });
    const statuses = responses.map((response) => response.status).sort();

    // Research R18: the second either arrives while the first runs (409) or after it is stored (an identical 201).
    expect([
      [201, 409],
      [201, 201],
    ]).toContainEqual(statuses);
    if (statuses[1] === 409) {
      const inProgress = responses.find((response) => response.status === 409);
      expect(inProgress?.body.error.code).toBe("IDEMPOTENCY_KEY_IN_PROGRESS");
    } else {
      expect(responses[0]?.body).toEqual(responses[1]?.body);
    }
    expect(await prisma.dailyReport.count()).toBe(1);
  });
});
