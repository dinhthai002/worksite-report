import { createPrismaClient } from "@src/shared/infrastructure/db";
import { loadExample } from "../../prisma/seed";
import { FixedClock } from "../fakes/fixed-clock";
import { truncateAll } from "../support/database";
import { createTestApp, TEST_NOW } from "../support/test-app";
import {
  Caller,
  ELECTRICAL,
  FOREMAN,
  FOUNDATION,
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

/**
 * The PRD example, row by row, on the seeded townhouse. Features 002 and 003 cover drafting, submitting and approval;
 * feature 004 extends this file next, with rejection and resubmission.
 */
describe("PRD example: three-storey townhouse", () => {
  const prisma = createPrismaClient(databaseUrl);
  const clock = new FixedClock(TEST_NOW);
  const app = createTestApp(prisma, {}, { clock });
  const mark = new Caller(app, MARK, FOREMAN);
  const linda = new Caller(app, LINDA, SITE_SUPERVISOR);

  beforeEach(async () => {
    clock.setTo(TEST_NOW);
    await truncateAll(prisma);
    await loadExample(prisma, "fill");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Mark drafts walls at 55% for 20 November, edits it, and submits it; approved progress stays 40%", async () => {
    const draft = await mark.saveDraft(TOWNHOUSE, "2026-11-20", { items: [{ taskId: WALLS, reportedProgress: 55 }] });
    const edited = await mark.saveDraft(TOWNHOUSE, "2026-11-20", {
      version: draft.body.version,
      note: "Rain from 15:00.",
      items: [{ taskId: WALLS, reportedProgress: 55 }],
    });

    const submitted = await mark.submit(draft.body.id, { version: edited.body.version });

    expect([draft.status, edited.status, submitted.status]).toEqual([201, 200, 200]);
    expect(submitted.body).toEqual(
      expect.objectContaining({ status: "SUBMITTED", version: 3, note: "Rain from 15:00." }),
    );
    expect(submitted.body.transitions).toHaveLength(1);
    const worksite = await linda.getWorksite(TOWNHOUSE);
    expect(worksite.body.tasks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: WALLS, approvedProgress: 40 })]),
    );
  });

  it("Linda approves Mark's report: walls becomes 55%, electrical stays 0%", async () => {
    const draft = await mark.saveDraft(TOWNHOUSE, "2026-11-20", { items: [{ taskId: WALLS, reportedProgress: 55 }] });
    const edited = await mark.saveDraft(TOWNHOUSE, "2026-11-20", {
      version: draft.body.version,
      note: "Rain from 15:00.",
      items: [{ taskId: WALLS, reportedProgress: 55 }],
    });
    const submitted = await mark.submit(draft.body.id, { version: edited.body.version });
    clock.setTo("2026-11-21T04:00:00Z");

    const approved = await linda.approve(draft.body.id, { version: submitted.body.version });

    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("APPROVED");
    expect(approved.body.transitions.map((transition: { toStatus: string }) => transition.toStatus)).toEqual([
      "SUBMITTED",
      "APPROVED",
    ]);
    const worksite = await linda.getWorksite(TOWNHOUSE);
    const progressById = Object.fromEntries(
      worksite.body.tasks.map((task: { id: string; approvedProgress: number }) => [task.id, task.approvedProgress]),
    );
    expect(progressById).toEqual({ [FOUNDATION]: 100, [WALLS]: 55, [ELECTRICAL]: 0 });
  });
});
