import { createPrismaClient } from "@src/shared/infrastructure/db";
import type { Response } from "supertest";
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
  const henry = new Caller(app, HENRY, FOREMAN);
  const linda = new Caller(app, LINDA, SITE_SUPERVISOR);

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

  it("BR-15 two approvals of one report from the same version: one 200, one 409", async () => {
    const draft = await mark.saveDraft(TOWNHOUSE, NOV_20, { items: [{ taskId: WALLS, reportedProgress: 55 }] });
    await mark.submit(draft.body.id, { version: 1 });

    const responses = settled(
      await Promise.allSettled([
        linda.approve(draft.body.id, { version: 2 }),
        linda.approve(draft.body.id, { version: 2 }),
      ]),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const loser = responses.find((response) => response.status === 409);
    // Clarifications: the version is checked before the status, so the loser is told to reload, never "already approved".
    expect(loser?.body.error.code).toBe("REPORT_VERSION_CONFLICT");
    expect(await prisma.reportTransition.count({ where: { reportId: draft.body.id, toStatus: "APPROVED" } })).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: WALLS } })).approvedProgress).toBe(55);
  });

  /** Henry's report for 20 November, electrical at 10%, SUBMITTED at version 2. */
  async function henrysSubmittedReport(): Promise<string> {
    const draft = await henry.saveDraft(TOWNHOUSE, NOV_20, { items: [{ taskId: ELECTRICAL, reportedProgress: 10 }] });
    await henry.submit(draft.body.id, { version: 1 });
    return draft.body.id;
  }

  it("BR-15 approve and reject of one report from the same version: one 200, one 409", async () => {
    const id = await henrysSubmittedReport();

    const [approval, rejection] = settled(
      await Promise.allSettled([
        linda.approve(id, { version: 2 }),
        linda.reject(id, { version: 2, reason: "conduit laid, no wiring pulled yet" }),
      ]),
    );

    const statuses = [approval?.status, rejection?.status];
    expect([...statuses].sort()).toEqual([200, 409]);
    const loser = approval?.status === 409 ? approval : rejection;
    // The version is checked before the status, so the loser is told to reload, never that the status forbids it.
    expect(loser?.body.error.code).toBe("REPORT_VERSION_CONFLICT");
    const view = await linda.getReport(id);
    expect(view.body.transitions).toHaveLength(2);
    const electrical = await prisma.task.findUniqueOrThrow({ where: { id: ELECTRICAL } });
    if (approval?.status === 200) {
      expect(view.body.status).toBe("APPROVED");
      expect(electrical.approvedProgress).toBe(10);
    } else {
      expect(view.body.status).toBe("REJECTED");
      expect(electrical.approvedProgress).toBe(0);
    }
  });

  it("BR-15 two rejections of one report from the same version: one 200, one 409", async () => {
    const id = await henrysSubmittedReport();

    const responses = settled(
      await Promise.allSettled([
        linda.reject(id, { version: 2, reason: "conduit laid, no wiring pulled yet" }),
        linda.reject(id, { version: 2, reason: "no wiring yet" }),
      ]),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body.error.code).toBe("REPORT_VERSION_CONFLICT");
    expect(await prisma.reportTransition.count({ where: { reportId: id, toStatus: "REJECTED" } })).toBe(1);
  });
});
