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

/**
 * The PRD example, row by row, on the seeded townhouse. Features 002 to 004 cover the whole example: drafting,
 * submitting, approval, rejection with a reason, and resubmission (UC-1 to UC-4).
 */
describe("PRD example: three-storey townhouse", () => {
  const prisma = createPrismaClient(databaseUrl);
  const clock = new FixedClock(TEST_NOW);
  const app = createTestApp(prisma, {}, { clock });
  const mark = new Caller(app, MARK, FOREMAN);
  const henry = new Caller(app, HENRY, FOREMAN);
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

  async function progress(): Promise<{ walls: number; electrical: number }> {
    const worksite = await linda.getWorksite(TOWNHOUSE);
    const byId = Object.fromEntries(
      worksite.body.tasks.map((task: { id: string; approvedProgress: number }) => [task.id, task.approvedProgress]),
    );
    return { walls: byId[WALLS], electrical: byId[ELECTRICAL] };
  }

  /** Runs the PRD example to its end; returns the IDs of both reports and the progress after each PRD row. */
  async function runTheExample(): Promise<{
    marks: string;
    henrys: string;
    rows: { walls: number; electrical: number }[];
    henrysEnd: { status: string; version: number; transitions: { toStatus: string; reason: string | null }[] };
  }> {
    const rows: { walls: number; electrical: number }[] = [];
    // Row 1: at the end of 20 November, both foremen submit.
    const marks = await mark.saveDraft(TOWNHOUSE, "2026-11-20", { items: [{ taskId: WALLS, reportedProgress: 55 }] });
    const henrys = await henry.saveDraft(TOWNHOUSE, "2026-11-20", {
      items: [{ taskId: ELECTRICAL, reportedProgress: 10 }],
    });
    expect((await mark.submit(marks.body.id, { version: 1 })).status).toBe(200);
    expect((await henry.submit(henrys.body.id, { version: 1 })).status).toBe(200);
    rows.push(await progress());
    // Row 2: Linda approves Mark's report.
    clock.setTo("2026-11-21T04:00:00Z");
    expect((await linda.approve(marks.body.id, { version: 2 })).status).toBe(200);
    rows.push(await progress());
    // Row 3: Linda rejects Henry's report, with the PRD's reason.
    const rejected = await linda.reject(henrys.body.id, { version: 2, reason: "conduit laid, no wiring pulled yet" });
    expect(rejected.status).toBe(200);
    rows.push(await progress());
    // Row 4: Henry changes the figure to 5% and resubmits; Linda approves.
    clock.setTo("2026-11-21T05:00:00Z");
    const corrected = await henry.saveDraft(TOWNHOUSE, "2026-11-20", {
      version: 3,
      items: [{ taskId: ELECTRICAL, reportedProgress: 5 }],
    });
    expect(corrected.status).toBe(200);
    expect((await henry.submit(henrys.body.id, { version: 4 })).status).toBe(200);
    expect(await progress()).toEqual({ walls: 55, electrical: 0 });
    clock.setTo("2026-11-21T06:00:00Z");
    const approved = await linda.approve(henrys.body.id, { version: 5 });
    expect(approved.status).toBe(200);
    rows.push(await progress());
    return { marks: marks.body.id, henrys: henrys.body.id, rows, henrysEnd: approved.body };
  }

  it("the PRD example, row by row: both submit, Linda approves Mark, rejects Henry, Henry corrects, Linda approves", async () => {
    const { rows, henrysEnd } = await runTheExample();

    expect(rows).toEqual([
      { walls: 40, electrical: 0 },
      { walls: 55, electrical: 0 },
      { walls: 55, electrical: 0 },
      { walls: 55, electrical: 5 },
    ]);
    expect(henrysEnd.status).toBe("APPROVED");
    expect(henrysEnd.version).toBe(6);
    expect(henrysEnd.transitions.map((transition) => [transition.toStatus, transition.reason])).toEqual([
      ["SUBMITTED", null],
      ["REJECTED", "conduit laid, no wiring pulled yet"],
      ["SUBMITTED", null],
      ["APPROVED", null],
    ]);
  });

  it("from the end of the example, Mark cannot report walls below 55% or report electrical for 21 November", async () => {
    await runTheExample();

    const below = await mark.saveDraft(TOWNHOUSE, "2026-11-21", { items: [{ taskId: WALLS, reportedProgress: 50 }] });
    const submitBelow = await mark.submit(below.body.id, { version: 1 });
    const electrical = await mark.saveDraft(TOWNHOUSE, "2026-11-21", {
      version: 1,
      items: [{ taskId: ELECTRICAL, reportedProgress: 10 }],
    });

    expect(submitBelow.status).toBe(422);
    expect(submitBelow.body.error).toEqual(
      expect.objectContaining({
        code: "PROGRESS_BELOW_APPROVED",
        details: expect.objectContaining({ taskId: WALLS, approvedProgress: 55 }),
      }),
    );
    expect(electrical.status).toBe(422);
    expect(electrical.body.error).toEqual(
      expect.objectContaining({
        code: "TASK_NOT_ASSIGNED_TO_AUTHOR",
        details: expect.objectContaining({ taskId: ELECTRICAL }),
      }),
    );
  });
});
