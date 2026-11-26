import { createPrismaClient } from "@src/shared/infrastructure/db";
import request from "supertest";
import { loadExample } from "../../prisma/seed";
import { FixedClock } from "../fakes/fixed-clock";
import { insertUser, insertWorksite, truncateAll } from "../support/database";
import { createTestApp, TEST_NOW } from "../support/test-app";
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
const REASON = "conduit laid, no wiring pulled yet";
/** Linda reviews an hour after the foremen submit, so transitions sort by time. */
const REVIEW_TIME = "2026-11-21T04:00:00Z";
/** Henry corrects his report after Linda's rejection. */
const CORRECTION_TIME = "2026-11-21T05:00:00Z";
/** Linda reviews the corrected report. */
const SECOND_REVIEW_TIME = "2026-11-21T06:00:00Z";

interface TransitionBody {
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly actorId: string;
  readonly reason: string | null;
}

/** POST /reports/:reportId/reject (contracts/reject-report.md; spec US1 to US4; UC-4). */
describe("POST /reports/:reportId/reject", () => {
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

  /** Henry drafts electrical at 10% for 20 November; returns the report ID (version 1, DRAFT). */
  async function henrysDraft(): Promise<string> {
    const draft = await henry.saveDraft(TOWNHOUSE, NOV_20, {
      items: [{ taskId: ELECTRICAL, reportedProgress: 10 }],
    });
    expect(draft.status).toBe(201);
    return draft.body.id;
  }

  /** Henry drafts and submits; returns the report ID (version 2, SUBMITTED). The clock then moves to REVIEW_TIME. */
  async function henrysSubmittedReport(): Promise<string> {
    const id = await henrysDraft();
    const submitted = await henry.submit(id, { version: 1 });
    expect(submitted.status).toBe(200);
    clock.setTo(REVIEW_TIME);
    return id;
  }

  /** Linda rejects Henry's submitted report; returns its ID (version 3, REJECTED). The clock moves to CORRECTION_TIME. */
  async function henrysRejectedReport(): Promise<string> {
    const id = await henrysSubmittedReport();
    const rejected = await linda.reject(id, { version: 2, reason: REASON });
    expect(rejected.status).toBe(200);
    clock.setTo(CORRECTION_TIME);
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

  async function statusAndVersion(id: string): Promise<{ status: string; version: number }> {
    return prisma.dailyReport.findUniqueOrThrow({ where: { id }, select: { status: true, version: true } });
  }

  function steps(transitions: readonly TransitionBody[]): (string | null)[][] {
    return transitions.map((t) => [t.fromStatus, t.toStatus, t.reason]);
  }

  describe("US1 reject a submitted report with a reason", () => {
    it("200: REJECTED, version + 1, the transition by Linda with the reason; no task changes", async () => {
      const id = await henrysSubmittedReport();

      const response = await linda.reject(id, { version: 2, reason: REASON });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(expect.objectContaining({ id, status: "REJECTED", version: 3 }));
      expect(response.body.transitions.at(-1)).toEqual({
        fromStatus: "SUBMITTED",
        toStatus: "REJECTED",
        actorId: LINDA,
        occurredAt: expect.stringMatching(/Z$/),
        reason: REASON,
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
        "Build ground-floor walls": 40,
        "Install electrical": 0,
      });
    });

    it("FR-011 after the rejection, Henry and Linda see REJECTED, the new version and both transitions oldest first", async () => {
      const id = await henrysRejectedReport();

      for (const caller of [henry, linda]) {
        const view = await caller.getReport(id);

        expect(view.status).toBe(200);
        expect(view.body).toEqual(expect.objectContaining({ status: "REJECTED", version: 3 }));
        expect(steps(view.body.transitions)).toEqual([
          ["DRAFT", "SUBMITTED", null],
          ["SUBMITTED", "REJECTED", REASON],
        ]);
      }
    });

    it.each([
      ["a report ID that is not a UUID", "not-a-uuid", { version: 2, reason: REASON }],
      ["a missing version", undefined, { reason: REASON }],
      ["a version of 0", undefined, { version: 0, reason: REASON }],
      ["a numeric reason", undefined, { version: 2, reason: 42 }],
      ["a reason of 2,001 characters", undefined, { version: 2, reason: "x".repeat(2001) }],
      ["a comment", undefined, { version: 2, reason: REASON, comment: "Please fix" }],
    ])("400 VALIDATION_FAILED for %s", async (_case, reportId, body) => {
      const id = reportId ?? (await henrysSubmittedReport());

      const response = await linda.reject(id, body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("FR-003 a reason of exactly 2,000 characters is accepted", async () => {
      const id = await henrysSubmittedReport();

      const response = await linda.reject(id, { version: 2, reason: "x".repeat(2000) });

      expect(response.status).toBe(200);
      expect(response.body.transitions.at(-1).reason).toHaveLength(2000);
    });

    it("400 VALIDATION_FAILED for a query parameter", async () => {
      const id = await henrysSubmittedReport();

      const response = await linda.reject(id, { version: 2, reason: REASON }).query({ force: "true" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("400 VALIDATION_FAILED without an Idempotency-Key", async () => {
      const id = await henrysSubmittedReport();

      const response = await request(app)
        .post(`/reports/${id}/reject`)
        .set("X-Actor-Id", LINDA)
        .set("X-Actor-Role", SITE_SUPERVISOR)
        .send({ version: 2, reason: REASON });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it.each([
      ["missing", { version: 2 }],
      ["null", { version: 2, reason: null }],
      ["empty", { version: 2, reason: "" }],
      ["blank", { version: 2, reason: "   " }],
    ])("BR-8 a %s reason gets 422 REJECTION_REASON_REQUIRED, and nothing changes", async (_case, body) => {
      const id = await henrysSubmittedReport();

      const response = await linda.reject(id, body);

      expect(response.status).toBe(422);
      expect(response.body.error).toEqual({
        code: "REJECTION_REASON_REQUIRED",
        message: "A reason is required to reject a report. Say what its author needs to change.",
      });
      expect(await statusAndVersion(id)).toEqual({ status: "SUBMITTED", version: 2 });
    });

    it("401 UNAUTHENTICATED without actor headers", async () => {
      const id = await henrysSubmittedReport();

      const response = await request(app)
        .post(`/reports/${id}/reject`)
        .set("Idempotency-Key", "k")
        .send({ version: 2, reason: REASON });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("404 REPORT_NOT_FOUND for an unknown report", async () => {
      const unknown = "00000000-0000-4000-8000-00000000ffff";

      const response = await linda.reject(unknown, { version: 1, reason: REASON });

      expect(response.status).toBe(404);
      expect(response.body.error).toEqual(
        expect.objectContaining({ code: "REPORT_NOT_FOUND", details: { reportId: unknown } }),
      );
    });

    it("FR-007 a worksite closed after submission can still be rejected", async () => {
      const id = await henrysSubmittedReport();
      await prisma.worksite.update({ where: { id: TOWNHOUSE }, data: { status: "CLOSED" } });

      const response = await linda.reject(id, { version: 2, reason: REASON });

      expect(response.status).toBe(200);
    });

    it("FR-007 a task reassigned after submission can still be rejected", async () => {
      const id = await henrysSubmittedReport();
      await prisma.task.update({ where: { id: ELECTRICAL }, data: { assigneeId: MARK } });

      const response = await linda.reject(id, { version: 2, reason: REASON });

      expect(response.status).toBe(200);
    });

    it("FR-007 a report that approval refuses as outdated can be rejected", async () => {
      const id = await henrysSubmittedReport();
      await prisma.task.update({ where: { id: ELECTRICAL }, data: { approvedProgress: 20 } });
      const approval = await linda.approve(id, { version: 2 });
      expect(approval.body.error.code).toBe("REPORT_PROGRESS_OUTDATED");

      const response = await linda.reject(id, { version: 2, reason: "Approved progress is already 20%." });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("REJECTED");
    });
  });

  describe("US2 after a rejection: the foreman reads the reason, edits and resubmits", () => {
    it("Henry's view shows the rejection by Linda with the reason", async () => {
      const id = await henrysRejectedReport();

      const view = await henry.getReport(id);

      expect(view.body.transitions.at(-1)).toEqual(
        expect.objectContaining({ fromStatus: "SUBMITTED", toStatus: "REJECTED", actorId: LINDA, reason: REASON }),
      );
    });

    it("BR-6 Henry saves electrical at 5%: the report stays REJECTED, and the response carries the reason", async () => {
      const id = await henrysRejectedReport();

      const saved = await henry.saveDraft(TOWNHOUSE, NOV_20, {
        version: 3,
        items: [{ taskId: ELECTRICAL, reportedProgress: 5 }],
      });

      expect(saved.status).toBe(200);
      expect(saved.body).toEqual(expect.objectContaining({ id, status: "REJECTED", version: 4 }));
      expect(saved.body.transitions.at(-1).reason).toBe(REASON);
    });

    it("BR-6 Henry resubmits after editing: SUBMITTED, with the rejection kept in the history", async () => {
      const id = await henrysRejectedReport();
      await henry.saveDraft(TOWNHOUSE, NOV_20, { version: 3, items: [{ taskId: ELECTRICAL, reportedProgress: 5 }] });

      const resubmitted = await henry.submit(id, { version: 4 });

      expect(resubmitted.status).toBe(200);
      expect(resubmitted.body).toEqual(expect.objectContaining({ status: "SUBMITTED", version: 5 }));
      expect(steps(resubmitted.body.transitions)).toEqual([
        ["DRAFT", "SUBMITTED", null],
        ["SUBMITTED", "REJECTED", REASON],
        ["REJECTED", "SUBMITTED", null],
      ]);
      expect(resubmitted.body.transitions.at(-1).actorId).toBe(HENRY);
    });

    it("Henry may resubmit without editing", async () => {
      const id = await henrysRejectedReport();

      const resubmitted = await henry.submit(id, { version: 3 });

      expect(resubmitted.status).toBe(200);
      expect(resubmitted.body).toEqual(expect.objectContaining({ status: "SUBMITTED", version: 4 }));
    });

    it("BR-15 resubmitting from the version read before his own edit is a conflict", async () => {
      const id = await henrysRejectedReport();
      await henry.saveDraft(TOWNHOUSE, NOV_20, { version: 3, items: [{ taskId: ELECTRICAL, reportedProgress: 5 }] });

      const resubmitted = await henry.submit(id, { version: 3 });

      expect(resubmitted.status).toBe(409);
      expect(resubmitted.body.error).toEqual(
        expect.objectContaining({
          code: "REPORT_VERSION_CONFLICT",
          details: { expectedVersion: 3, currentVersion: 4 },
        }),
      );
      expect(await statusAndVersion(id)).toEqual({ status: "REJECTED", version: 4 });
    });

    it("UC-4 no task changes until the final approval, which sets electrical to 5", async () => {
      const id = await henrysRejectedReport();
      const untouched = { ...(await approvedProgress()) };
      expect(untouched[ELECTRICAL]).toBe(0);

      await henry.saveDraft(TOWNHOUSE, NOV_20, { version: 3, items: [{ taskId: ELECTRICAL, reportedProgress: 5 }] });
      expect(await approvedProgress()).toEqual(untouched);
      await henry.submit(id, { version: 4 });
      expect(await approvedProgress()).toEqual(untouched);
      clock.setTo(SECOND_REVIEW_TIME);
      const approved = await linda.approve(id, { version: 5 });

      expect(approved.status).toBe(200);
      expect(approved.body.transitions).toHaveLength(4);
      expect(await approvedProgress()).toEqual({ ...untouched, [ELECTRICAL]: 5 });
    });

    it("a report rejected twice keeps both reasons, oldest first", async () => {
      const id = await henrysRejectedReport();
      await henry.submit(id, { version: 3 });
      clock.setTo(SECOND_REVIEW_TIME);

      const second = await linda.reject(id, { version: 4, reason: "wiring incomplete" });

      expect(second.status).toBe(200);
      expect(steps(second.body.transitions)).toEqual([
        ["DRAFT", "SUBMITTED", null],
        ["SUBMITTED", "REJECTED", REASON],
        ["REJECTED", "SUBMITTED", null],
        ["SUBMITTED", "REJECTED", "wiring incomplete"],
      ]);
    });

    it("BR-4 after electrical is reassigned to Mark, Henry can neither save it nor resubmit", async () => {
      const id = await henrysRejectedReport();
      await prisma.task.update({ where: { id: ELECTRICAL }, data: { assigneeId: MARK } });

      const saved = await henry.saveDraft(TOWNHOUSE, NOV_20, {
        version: 3,
        items: [{ taskId: ELECTRICAL, reportedProgress: 5 }],
      });
      const resubmitted = await henry.submit(id, { version: 3 });

      for (const response of [saved, resubmitted]) {
        expect(response.status).toBe(422);
        expect(response.body.error).toEqual(
          expect.objectContaining({
            code: "TASK_NOT_ASSIGNED_TO_AUTHOR",
            details: expect.objectContaining({ taskId: ELECTRICAL }),
          }),
        );
      }
      expect(await statusAndVersion(id)).toEqual({ status: "REJECTED", version: 3 });
    });

    it("BR-5 after electrical's approved progress rises to 20, resubmitting at 10 is refused until Henry raises it", async () => {
      const id = await henrysRejectedReport();
      await prisma.task.update({ where: { id: ELECTRICAL }, data: { approvedProgress: 20 } });

      const refused = await henry.submit(id, { version: 3 });
      await henry.saveDraft(TOWNHOUSE, NOV_20, { version: 3, items: [{ taskId: ELECTRICAL, reportedProgress: 20 }] });
      const accepted = await henry.submit(id, { version: 4 });

      expect(refused.status).toBe(422);
      expect(refused.body.error).toEqual(
        expect.objectContaining({
          code: "PROGRESS_BELOW_APPROVED",
          details: expect.objectContaining({ taskId: ELECTRICAL, approvedProgress: 20 }),
        }),
      );
      expect(accepted.status).toBe(200);
      expect(accepted.body.status).toBe("SUBMITTED");
    });

    it("BR-7 a rejected report saved with no items stays REJECTED and cannot be resubmitted", async () => {
      const id = await henrysRejectedReport();

      const saved = await henry.saveDraft(TOWNHOUSE, NOV_20, { version: 3, items: [] });
      const resubmitted = await henry.submit(id, { version: 4 });

      expect(saved.status).toBe(200);
      expect(saved.body).toEqual(expect.objectContaining({ status: "REJECTED", version: 4, items: [] }));
      expect(resubmitted.status).toBe(422);
      expect(resubmitted.body.error.code).toBe("REPORT_HAS_NO_ITEMS");
    });

    it("BR-3 after the townhouse is closed, a rejected report can be neither saved nor resubmitted (P6)", async () => {
      const id = await henrysRejectedReport();
      await prisma.worksite.update({ where: { id: TOWNHOUSE }, data: { status: "CLOSED" } });

      const saved = await henry.saveDraft(TOWNHOUSE, NOV_20, {
        version: 3,
        items: [{ taskId: ELECTRICAL, reportedProgress: 5 }],
      });
      const resubmitted = await henry.submit(id, { version: 3 });

      for (const response of [saved, resubmitted]) {
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe("WORKSITE_CLOSED");
      }
      expect(await statusAndVersion(id)).toEqual({ status: "REJECTED", version: 3 });
    });
  });

  describe("US3 only the worksite's site supervisor rejects, and only a submitted report", () => {
    it("BR-12 Henry, Mark and the supervisor of another worksite each get the same 403, and nothing changes", async () => {
      const id = await henrysSubmittedReport();
      const sam = await aSupervisorOfAnotherWorksite();

      const responses = [
        await henry.reject(id, { version: 2, reason: REASON }),
        await mark.reject(id, { version: 2, reason: REASON }),
        await sam.reject(id, { version: 2, reason: REASON }),
      ];

      for (const response of responses) {
        expect(response.status).toBe(403);
        expect(response.body.error).toEqual({
          code: "REPORT_REJECTION_FORBIDDEN",
          message:
            "You may not reject this report. Only the site supervisor of its worksite may reject it, once it is submitted.",
          details: { reportId: id },
        });
      }
      expect(await statusAndVersion(id)).toEqual({ status: "SUBMITTED", version: 2 });
    });

    it("FR-008 Linda rejecting a DRAFT gets exactly the answer the other supervisor gets", async () => {
      const id = await henrysDraft();
      const sam = await aSupervisorOfAnotherWorksite();

      const forDraft = await linda.reject(id, { version: 1, reason: REASON });
      const forSam = await sam.reject(id, { version: 1, reason: REASON });

      expect(forDraft.status).toBe(403);
      expect(forDraft.body).toEqual(forSam.body);
    });

    it("FR-021 callers who may not reject get 403 even without a reason", async () => {
      const id = await henrysSubmittedReport();
      const sam = await aSupervisorOfAnotherWorksite();

      for (const caller of [henry, mark, sam]) {
        const response = await caller.reject(id, { version: 2 });

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe("REPORT_REJECTION_FORBIDDEN");
      }
    });

    it("BR-10 an APPROVED report cannot be rejected, and its task keeps its progress", async () => {
      const draft = await mark.saveDraft(TOWNHOUSE, NOV_20, { items: [{ taskId: WALLS, reportedProgress: 55 }] });
      await mark.submit(draft.body.id, { version: 1 });
      clock.setTo(REVIEW_TIME);
      await linda.approve(draft.body.id, { version: 2 });

      const response = await linda.reject(draft.body.id, { version: 3, reason: REASON });

      expect(response.status).toBe(409);
      expect(response.body.error).toEqual(
        expect.objectContaining({ code: "INVALID_STATUS_TRANSITION", details: { from: "APPROVED", to: "REJECTED" } }),
      );
      expect((await approvedProgress())[WALLS]).toBe(55);
    });

    it("a REJECTED report cannot be rejected again", async () => {
      const id = await henrysRejectedReport();

      const response = await linda.reject(id, { version: 3, reason: "again" });

      expect(response.status).toBe(409);
      expect(response.body.error).toEqual(
        expect.objectContaining({ code: "INVALID_STATUS_TRANSITION", details: { from: "REJECTED", to: "REJECTED" } }),
      );
    });

    it("BR-15 an older version gets 409 with the current version, and nothing changes", async () => {
      const id = await henrysSubmittedReport();

      const response = await linda.reject(id, { version: 1, reason: REASON });

      expect(response.status).toBe(409);
      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: "REPORT_VERSION_CONFLICT",
          details: { expectedVersion: 1, currentVersion: 2 },
        }),
      );
      expect(await statusAndVersion(id)).toEqual({ status: "SUBMITTED", version: 2 });
    });
  });

  describe("US4 retries", () => {
    it("BR-14 five identical rejections with one key yield one rejection and five identical responses", async () => {
      const id = await henrysSubmittedReport();

      const responses = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        responses.push(await linda.reject(id, { version: 2, reason: REASON }, "reject-once"));
      }

      expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
      for (const response of responses) {
        expect(response.body).toEqual(responses[0]?.body);
      }
      expect(await prisma.reportTransition.count({ where: { reportId: id, toStatus: "REJECTED" } })).toBe(1);
    });

    it("BR-14 the same key with another reason is refused as already used, and nothing changes", async () => {
      const id = await henrysSubmittedReport();
      await linda.reject(id, { version: 2, reason: REASON }, "reject-key");

      const response = await linda.reject(id, { version: 2, reason: "something else" }, "reject-key");

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect(await statusAndVersion(id)).toEqual({ status: "REJECTED", version: 3 });
    });

    it("BR-14 a refused rejection releases its key: the same key with a reason then succeeds", async () => {
      const id = await henrysSubmittedReport();
      const refused = await linda.reject(id, { version: 2 }, "reject-later");
      expect(refused.body.error.code).toBe("REJECTION_REASON_REQUIRED");

      const response = await linda.reject(id, { version: 2, reason: REASON }, "reject-later");

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("REJECTED");
    });
  });
});
