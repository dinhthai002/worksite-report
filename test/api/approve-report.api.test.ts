import { createPrismaClient } from "@src/shared/infrastructure/db";
import request from "supertest";
import { loadExample } from "../../prisma/seed";
import { FixedClock } from "../fakes/fixed-clock";
import {
  insertReport,
  insertReportItem,
  insertTransition,
  insertUser,
  insertWorksite,
  truncateAll,
} from "../support/database";
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

const NOV_19 = "2026-11-19";
const NOV_20 = "2026-11-20";
const NOV_21 = "2026-11-21";
/** An hour after TEST_NOW, still 21 November: Linda reviews after Mark submits, so transitions sort by time. */
const REVIEW_TIME = "2026-11-21T04:00:00Z";

/** POST /reports/:reportId/approve (contracts/approve-report.md; spec US1 to US4; UC-3). */
describe("POST /reports/:reportId/approve", () => {
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

  /** Mark drafts walls at the given progress for a work date; returns the report ID (version 1, DRAFT). */
  async function marksDraft(workDate: string, progress: number): Promise<string> {
    const draft = await mark.saveDraft(TOWNHOUSE, workDate, { items: [{ taskId: WALLS, reportedProgress: progress }] });
    expect(draft.status).toBe(201);
    return draft.body.id;
  }

  /** Mark drafts and submits; returns the report ID (version 2, SUBMITTED). The clock then moves to REVIEW_TIME. */
  async function marksSubmittedReport(workDate = NOV_20, progress = 55): Promise<string> {
    const id = await marksDraft(workDate, progress);
    const submitted = await mark.submit(id, { version: 1 });
    expect(submitted.status).toBe(200);
    clock.setTo(REVIEW_TIME);
    return id;
  }

  async function approvedProgress(): Promise<Record<string, number>> {
    const tasks = await prisma.task.findMany({ where: { worksiteId: TOWNHOUSE } });
    return Object.fromEntries(tasks.map((task) => [task.id, task.approvedProgress]));
  }

  async function aSupervisorOfAnotherWorksite(): Promise<Caller> {
    const sam = await insertUser(prisma, { role: "SITE_SUPERVISOR" });
    await insertWorksite(prisma, { supervisorId: sam.id });
    return new Caller(app, sam.id, SITE_SUPERVISOR);
  }

  describe("US1 approve a submitted report", () => {
    it("200: APPROVED, version + 1, the transition by Linda; the townhouse shows walls 55, foundation 100, electrical 0", async () => {
      const id = await marksSubmittedReport();

      const response = await linda.approve(id, { version: 2 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(expect.objectContaining({ id, status: "APPROVED", version: 3 }));
      expect(response.body.transitions.at(-1)).toEqual({
        fromStatus: "SUBMITTED",
        toStatus: "APPROVED",
        actorId: LINDA,
        occurredAt: expect.stringMatching(/Z$/),
        reason: null,
      });
      const worksite = await linda.getWorksite(TOWNHOUSE);
      const progressByName = Object.fromEntries(
        worksite.body.tasks.map((task: { name: string; approvedProgress: number }) => [
          task.name,
          task.approvedProgress,
        ]),
      );
      expect(progressByName).toEqual({
        "Pour foundation": 100,
        "Build ground-floor walls": 55,
        "Install electrical": 0,
      });
    });

    it.each([
      ["a report ID that is not a UUID", "not-a-uuid", { version: 2 }],
      ["a missing version", undefined, {}],
      ["a version of 0", undefined, { version: 0 }],
      ["a comment", undefined, { version: 2, comment: "Good work" }],
      ["a reason", undefined, { version: 2, reason: "Looks right" }],
    ])("400 VALIDATION_FAILED for %s", async (_case, reportId, body) => {
      const id = reportId ?? (await marksSubmittedReport());

      const response = await linda.approve(id, body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("400 VALIDATION_FAILED for a query parameter", async () => {
      const id = await marksSubmittedReport();

      const response = await linda.approve(id, { version: 2 }).query({ force: "true" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("400 VALIDATION_FAILED without an Idempotency-Key", async () => {
      const id = await marksSubmittedReport();

      const response = await request(app)
        .post(`/reports/${id}/approve`)
        .set("X-Actor-Id", LINDA)
        .set("X-Actor-Role", SITE_SUPERVISOR)
        .send({ version: 2 });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("401 UNAUTHENTICATED without actor headers", async () => {
      const id = await marksSubmittedReport();

      const response = await request(app)
        .post(`/reports/${id}/approve`)
        .set("Idempotency-Key", "k")
        .send({ version: 2 });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("404 REPORT_NOT_FOUND for an unknown report", async () => {
      const unknown = "00000000-0000-4000-8000-00000000ffff";

      const response = await linda.approve(unknown, { version: 1 });

      expect(response.status).toBe(404);
      expect(response.body.error).toEqual(
        expect.objectContaining({ code: "REPORT_NOT_FOUND", details: { reportId: unknown } }),
      );
    });

    it("after approval, Mark and Linda see APPROVED, the new version and both transitions oldest first", async () => {
      const id = await marksSubmittedReport();
      await linda.approve(id, { version: 2 });

      for (const viewer of [mark, linda]) {
        const response = await viewer.getReport(id);

        expect(response.status).toBe(200);
        expect(response.body.status).toBe("APPROVED");
        expect(response.body.version).toBe(3);
        expect(response.body.transitions.map((transition: { toStatus: string }) => transition.toStatus)).toEqual([
          "SUBMITTED",
          "APPROVED",
        ]);
      }
    });
  });

  describe("US2 approval is all or nothing", () => {
    it("BR-5 approving the 19th after the 21st is refused with every outdated task, and nothing changes", async () => {
      const nineteenth = await marksSubmittedReport(NOV_19, 56);
      const twentyFirst = await marksSubmittedReport(NOV_21, 70);
      expect((await linda.approve(twentyFirst, { version: 2 })).status).toBe(200);

      const response = await linda.approve(nineteenth, { version: 2 });

      expect(response.status).toBe(422);
      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: "REPORT_PROGRESS_OUTDATED",
          details: {
            tasks: [
              { taskId: WALLS, taskName: "Build ground-floor walls", reportedProgress: 56, approvedProgress: 70 },
            ],
          },
        }),
      );
      const view = await mark.getReport(nineteenth);
      expect(view.body.status).toBe("SUBMITTED");
      expect(view.body.version).toBe(2);
      expect(view.body.transitions).toHaveLength(1);
      expect((await approvedProgress())[WALLS]).toBe(70);
    });

    it("BR-5 approving in date order succeeds twice and ends at the later figure", async () => {
      const nineteenth = await marksSubmittedReport(NOV_19, 56);
      const twentyFirst = await marksSubmittedReport(NOV_21, 70);

      expect((await linda.approve(nineteenth, { version: 2 })).status).toBe(200);
      expect((await linda.approve(twentyFirst, { version: 2 })).status).toBe(200);
      expect((await approvedProgress())[WALLS]).toBe(70);
    });
  });

  describe("US3 only the worksite's site supervisor approves, and only once", () => {
    it.each([
      ["Mark, the author", mark],
      ["Henry, another foreman", henry],
    ])("BR-12 %s gets 403 and the report stays SUBMITTED", async (_who, caller) => {
      const id = await marksSubmittedReport();

      const response = await caller.approve(id, { version: 2 });

      expect(response.status).toBe(403);
      expect(response.body.error).toEqual(
        expect.objectContaining({ code: "REPORT_APPROVAL_FORBIDDEN", details: { reportId: id } }),
      );
      const view = await mark.getReport(id);
      expect(view.body).toEqual(expect.objectContaining({ status: "SUBMITTED", version: 2 }));
    });

    it("BR-12 the site supervisor of another worksite gets 403", async () => {
      const id = await marksSubmittedReport();
      const sam = await aSupervisorOfAnotherWorksite();

      const response = await sam.approve(id, { version: 2 });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("REPORT_APPROVAL_FORBIDDEN");
    });

    it("FR-009 Linda approving a DRAFT gets exactly the answer the other supervisor gets", async () => {
      const draft = await marksDraft(NOV_20, 55);
      const sam = await aSupervisorOfAnotherWorksite();

      const forDraft = await linda.approve(draft, { version: 1 });
      const forSam = await sam.approve(draft, { version: 1 });

      expect(forDraft.status).toBe(403);
      expect(forDraft.body).toEqual(forSam.body);
    });

    it("BR-15 an older version gets 409 with the current version, and nothing changes", async () => {
      const id = await marksSubmittedReport();

      const response = await linda.approve(id, { version: 1 });

      expect(response.status).toBe(409);
      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: "REPORT_VERSION_CONFLICT",
          details: { expectedVersion: 1, currentVersion: 2 },
        }),
      );
      expect((await approvedProgress())[WALLS]).toBe(40);
    });

    it("BR-10 an APPROVED report cannot be approved again, saved or submitted", async () => {
      const id = await marksSubmittedReport();
      await linda.approve(id, { version: 2 });

      const again = await linda.approve(id, { version: 3 });
      const save = await mark.saveDraft(TOWNHOUSE, NOV_20, {
        version: 3,
        items: [{ taskId: WALLS, reportedProgress: 60 }],
      });
      const submit = await mark.submit(id, { version: 3 });

      expect(again.status).toBe(409);
      expect(again.body.error).toEqual(
        expect.objectContaining({ code: "INVALID_STATUS_TRANSITION", details: { from: "APPROVED", to: "APPROVED" } }),
      );
      expect(save.status).toBe(409);
      expect(save.body.error.code).toBe("REPORT_NOT_EDITABLE");
      expect(submit.status).toBe(409);
      expect(submit.body.error.code).toBe("INVALID_STATUS_TRANSITION");
    });

    it("a REJECTED report gets 409 INVALID_STATUS_TRANSITION, stating the status", async () => {
      const report = await insertReport(prisma, {
        worksiteId: TOWNHOUSE,
        authorId: MARK,
        workDate: NOV_20,
        status: "REJECTED",
        version: 3,
      });
      await insertReportItem(prisma, { reportId: report.id, taskId: WALLS, reportedProgress: 55 });
      await insertTransition(prisma, { reportId: report.id, actorId: MARK });
      await insertTransition(prisma, {
        reportId: report.id,
        actorId: LINDA,
        fromStatus: "SUBMITTED",
        toStatus: "REJECTED",
        occurredAt: new Date("2026-11-20T15:00:00Z"),
        reason: "conduit laid, no wiring pulled yet",
      });

      const response = await linda.approve(report.id, { version: 3 });

      expect(response.status).toBe(409);
      expect(response.body.error).toEqual(
        expect.objectContaining({ code: "INVALID_STATUS_TRANSITION", details: { from: "REJECTED", to: "APPROVED" } }),
      );
    });

    it("FR-008 a worksite closed after submission can still be approved", async () => {
      const id = await marksSubmittedReport();
      await prisma.worksite.update({ where: { id: TOWNHOUSE }, data: { status: "CLOSED" } });

      const response = await linda.approve(id, { version: 2 });

      expect(response.status).toBe(200);
      expect((await approvedProgress())[WALLS]).toBe(55);
    });

    it("FR-008 a task reassigned after submission can still be approved, and keeps its new assignee", async () => {
      const id = await marksSubmittedReport();
      await prisma.task.update({ where: { id: WALLS }, data: { assigneeId: HENRY } });

      const response = await linda.approve(id, { version: 2 });

      expect(response.status).toBe(200);
      const walls = await prisma.task.findUniqueOrThrow({ where: { id: WALLS } });
      expect(walls.approvedProgress).toBe(55);
      expect(walls.assigneeId).toBe(HENRY);
    });
  });

  describe("US4 retries", () => {
    it("BR-14 five identical approvals with one key yield one approval and five identical responses", async () => {
      const id = await marksSubmittedReport();
      const key = "approve-once";

      const first = await linda.approve(id, { version: 2 }, key);
      const wallsAfterFirst = await prisma.task.findUniqueOrThrow({ where: { id: WALLS } });
      const repeats = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        repeats.push(await linda.approve(id, { version: 2 }, key));
      }

      expect(first.status).toBe(200);
      for (const repeat of repeats) {
        expect(repeat.status).toBe(200);
        expect(repeat.body).toEqual(first.body);
      }
      expect(await prisma.reportTransition.count({ where: { reportId: id, toStatus: "APPROVED" } })).toBe(1);
      const wallsAfterRepeats = await prisma.task.findUniqueOrThrow({ where: { id: WALLS } });
      expect(wallsAfterRepeats.updatedAt).toEqual(wallsAfterFirst.updatedAt);
    });

    it("BR-14 the same key with another version is refused as already used, and nothing changes", async () => {
      const id = await marksSubmittedReport();
      await linda.approve(id, { version: 2 }, "approve-key");

      const response = await linda.approve(id, { version: 3 }, "approve-key");

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect(await prisma.reportTransition.count({ where: { reportId: id, toStatus: "APPROVED" } })).toBe(1);
    });

    it("BR-14 a refused approval releases its key: the same request later is processed afresh", async () => {
      const id = await marksDraft(NOV_20, 55);
      const refused = await linda.approve(id, { version: 1 }, "approve-draft");
      expect(refused.status).toBe(403);
      await mark.submit(id, { version: 1 });

      const retried = await linda.approve(id, { version: 1 }, "approve-draft");

      expect(retried.status).toBe(409);
      expect(retried.body.error.code).toBe("REPORT_VERSION_CONFLICT");
    });
  });

  it("only the report's tasks change: Henry's task is untouched", async () => {
    const id = await marksSubmittedReport();

    await linda.approve(id, { version: 2 });

    expect(await approvedProgress()).toEqual({ [FOUNDATION]: 100, [WALLS]: 55, [ELECTRICAL]: 0 });
  });
});
