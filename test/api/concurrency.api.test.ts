import { createPrismaClient } from "@src/shared/infrastructure/db";
import type { Response } from "supertest";
import { loadExample } from "../../prisma/seed";
import { truncateAll } from "../support/database";
import { createTestApp } from "../support/test-app";
import { Caller, FOREMAN, MARK, TOWNHOUSE, WALLS } from "../support/townhouse";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is not set. API tests must run through Jest, which starts PostgreSQL.");
}

const NOV_20 = "2026-11-20";

function settled(outcomes: PromiseSettledResult<Response>[]): Response[] {
  return outcomes.map((outcome) => {
    if (outcome.status === "rejected") {
      throw outcome.reason;
    }
    return outcome.value;
  });
}

/** UC-1 acceptance and PRD implementation goal 2: no silent overwrites. Asserts on outcome sets (testing.md 4). */
describe("concurrent writes", () => {
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

  it("BR-15 two saves from the same version: one 200, one 409 with the current version", async () => {
    await mark.saveDraft(TOWNHOUSE, NOV_20, { items: [{ taskId: WALLS, reportedProgress: 55 }] });

    const responses = settled(
      await Promise.allSettled([
        mark.saveDraft(TOWNHOUSE, NOV_20, {
          version: 1,
          note: "device A",
          items: [{ taskId: WALLS, reportedProgress: 60 }],
        }),
        mark.saveDraft(TOWNHOUSE, NOV_20, {
          version: 1,
          note: "device B",
          items: [{ taskId: WALLS, reportedProgress: 65 }],
        }),
      ]),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = responses.find((response) => response.status === 200);
    const loser = responses.find((response) => response.status === 409);
    expect(loser?.body.error).toEqual(
      expect.objectContaining({ code: "REPORT_VERSION_CONFLICT", details: { expectedVersion: 1, currentVersion: 2 } }),
    );
    const stored = await prisma.dailyReport.findFirstOrThrow({ include: { items: true } });
    expect([stored.version, stored.note, stored.items[0]?.reportedProgress]).toEqual([
      2,
      winner?.body.note,
      winner?.body.items[0].reportedProgress,
    ]);
  });

  it("BR-1 ten concurrent first saves create one report", async () => {
    const responses = settled(
      await Promise.allSettled(
        Array.from({ length: 10 }, (_, attempt) =>
          mark.saveDraft(TOWNHOUSE, NOV_20, { items: [{ taskId: WALLS, reportedProgress: 50 + attempt }] }),
        ),
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 200, 200, 200, 200, 200, 200, 200, 200, 201,
    ]);
    expect(new Set(responses.map((response) => response.body.id)).size).toBe(1);
    expect(await prisma.dailyReport.count()).toBe(1);
  });
});
