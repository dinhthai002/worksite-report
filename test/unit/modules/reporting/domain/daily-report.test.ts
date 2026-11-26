import {
  ALLOWED_TRANSITIONS,
  assertCanCreateReportFor,
  assertTransition,
  DailyReport,
  type DraftContent,
  isEditable,
  ReportStatus,
  toReportId,
  toWorkDate,
} from "@src/modules/reporting/domain/daily-report";
import type { Worksite } from "@src/modules/worksite";
import { type Actor, Role, toUserId } from "@src/shared/domain/actor";
import { ConflictError, ForbiddenError, RuleViolationError } from "@src/shared/domain/errors";
import { toTaskId } from "@src/shared/domain/ids";
import { aReport } from "../../../../support/daily-report.builder";
import { aTask, aWorksite } from "../../../../support/worksite.builder";

const STATUSES = Object.values(ReportStatus);

describe("ReportStatus", () => {
  // TST-11: every pair of statuses, each either allowed or refused.
  const pairs = STATUSES.flatMap((from) => STATUSES.map((to) => [from, to] as const));
  const allowed = new Set(ALLOWED_TRANSITIONS.map(([from, to]) => `${from}->${to}`));

  it("covers all 16 pairs, 4 of them allowed", () => {
    expect(pairs).toHaveLength(16);
    expect(pairs.filter(([from, to]) => allowed.has(`${from}->${to}`))).toHaveLength(4);
  });

  it.each(pairs.filter(([from, to]) => allowed.has(`${from}->${to}`)))("allows %s -> %s", (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each(pairs.filter(([from, to]) => !allowed.has(`${from}->${to}`)))("refuses %s -> %s", (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(ConflictError);
    expect(() => assertTransition(from, to)).toThrow(
      expect.objectContaining({ code: "INVALID_STATUS_TRANSITION", details: { from, to } }),
    );
  });

  it("names the statuses that may make the transition", () => {
    expect(() => assertTransition(ReportStatus.SUBMITTED, ReportStatus.SUBMITTED)).toThrow(
      "A SUBMITTED report cannot be submitted. Only a DRAFT or REJECTED report can be.",
    );
  });

  it("BR-6 isEditable is true exactly for DRAFT and REJECTED", () => {
    expect(STATUSES.filter(isEditable)).toEqual([ReportStatus.DRAFT, ReportStatus.REJECTED]);
  });
});

const MARK: Actor = { id: toUserId("00000000-0000-4000-8000-000000000002"), role: Role.FOREMAN };
const HENRY: Actor = { id: toUserId("00000000-0000-4000-8000-000000000003"), role: Role.FOREMAN };
const LINDA: Actor = { id: toUserId("00000000-0000-4000-8000-000000000001"), role: Role.SITE_SUPERVISOR };
const WALLS = "00000000-0000-4000-8000-000000000202";
const ELECTRICAL = "00000000-0000-4000-8000-000000000203";
const FOUNDATION = "00000000-0000-4000-8000-000000000201";

function townhouse(build = aWorksite()): Worksite {
  return build
    .supervisedBy(LINDA.id)
    .withTasks(
      aTask().withId(FOUNDATION).named("Pour foundation").assignedTo(MARK.id).withApprovedProgress(100).build(),
      aTask().withId(WALLS).named("Build ground-floor walls").assignedTo(MARK.id).withApprovedProgress(40).build(),
      aTask().withId(ELECTRICAL).named("Install electrical").assignedTo(HENRY.id).withApprovedProgress(0).build(),
    )
    .build();
}

function content(...items: { taskId: string; reportedProgress: number }[]): DraftContent {
  return { note: null, items: items.map((item) => ({ ...item, taskId: toTaskId(item.taskId), note: null })) };
}

function createFor(author: Actor, worksite: Worksite, draft: DraftContent): DailyReport {
  return DailyReport.create({
    id: toReportId("5f0c8a52-3d55-4c3e-9a0e-2b7f8f4f9b11"),
    author,
    worksite,
    workDate: toWorkDate("2026-11-20"),
    today: "2026-11-21",
    backdateLimitDays: 365,
    content: draft,
  });
}

describe("BR-2 work date", () => {
  it("BR-2 rejects a future work date", () => {
    expect(() => assertCanCreateReportFor(toWorkDate("2026-11-22"), "2026-11-21", 365)).toThrow(RuleViolationError);
  });

  it("BR-2 rejects a work date more than the limit before today", () => {
    expect(() => assertCanCreateReportFor(toWorkDate("2025-11-20"), "2026-11-21", 365)).toThrow(
      expect.objectContaining({
        code: "WORK_DATE_OUT_OF_RANGE",
        message: "The work date 2025-11-20 is outside the allowed range 2025-11-21 to 2026-11-21.",
        details: { workDate: "2025-11-20", earliest: "2025-11-21", latest: "2026-11-21" },
      }),
    );
  });

  it.each(["2025-11-21", "2026-11-21"])("BR-2 accepts the boundary date %s", (workDate) => {
    expect(() => assertCanCreateReportFor(toWorkDate(workDate), "2026-11-21", 365)).not.toThrow();
  });

  it("BR-2 counts across a leap day", () => {
    expect(() => assertCanCreateReportFor(toWorkDate("2027-03-01"), "2028-03-01", 365)).toThrow(
      expect.objectContaining({ details: expect.objectContaining({ earliest: "2027-03-02" }) }),
    );
    expect(() => assertCanCreateReportFor(toWorkDate("2027-03-02"), "2028-03-01", 365)).not.toThrow();
  });

  it("BR-2 counts back into January and February", () => {
    expect(() => assertCanCreateReportFor(toWorkDate("2025-02-09"), "2026-02-10", 365)).toThrow(
      expect.objectContaining({ details: expect.objectContaining({ earliest: "2025-02-10" }) }),
    );
    expect(() => assertCanCreateReportFor(toWorkDate("2025-12-27"), "2026-01-03", 5)).toThrow(
      expect.objectContaining({ details: expect.objectContaining({ earliest: "2025-12-29" }) }),
    );
  });

  it("BR-2 works with a small limit across a month end", () => {
    expect(() => assertCanCreateReportFor(toWorkDate("2026-11-26"), "2026-12-02", 5)).toThrow(
      expect.objectContaining({ details: expect.objectContaining({ earliest: "2026-11-27" }) }),
    );
  });
});

describe("create and edit", () => {
  it("creates a DRAFT report with version 1 and no transitions", () => {
    const report = createFor(MARK, townhouse(), content({ taskId: WALLS, reportedProgress: 55 }));

    expect(report).toEqual(
      expect.objectContaining({ status: ReportStatus.DRAFT, version: 1, authorId: MARK.id, transitions: [] }),
    );
    expect(report.items.map((item) => [item.taskId, item.reportedProgress])).toEqual([[WALLS, 55]]);
  });

  it("BR-3 rejects creating a report for a CLOSED worksite", () => {
    const create = (): DailyReport =>
      createFor(MARK, townhouse(aWorksite().closed()), content({ taskId: WALLS, reportedProgress: 55 }));

    expect(create).toThrow(expect.objectContaining({ code: "WORKSITE_CLOSED" }));
  });

  it("BR-3 rejects editing a report for a CLOSED worksite", () => {
    const report = aReport().by(MARK.id).build();

    expect(() => report.edit(MARK, townhouse(aWorksite().closed()), content())).toThrow(
      expect.objectContaining({ code: "WORKSITE_CLOSED" }),
    );
  });

  it("BR-4 rejects a duplicated task, naming it", () => {
    const draft = content({ taskId: WALLS, reportedProgress: 55 }, { taskId: WALLS, reportedProgress: 60 });

    expect(() => createFor(MARK, townhouse(), draft)).toThrow(
      expect.objectContaining({ code: "TASK_LISTED_TWICE", details: { taskId: WALLS } }),
    );
  });

  it("BR-4 rejects a task of another worksite, naming it", () => {
    const elsewhere = "00000000-0000-4000-8000-000000000999";

    expect(() => createFor(MARK, townhouse(), content({ taskId: elsewhere, reportedProgress: 10 }))).toThrow(
      expect.objectContaining({
        code: "TASK_NOT_IN_WORKSITE",
        details: expect.objectContaining({ taskId: elsewhere }),
      }),
    );
  });

  it("BR-4 rejects a task assigned to another foreman, naming it", () => {
    expect(() => createFor(MARK, townhouse(), content({ taskId: ELECTRICAL, reportedProgress: 10 }))).toThrow(
      expect.objectContaining({
        code: "TASK_NOT_ASSIGNED_TO_AUTHOR",
        details: { taskId: ELECTRICAL, taskName: "Install electrical" },
      }),
    );
  });

  it("BR-5 rejects progress outside 0 to 100 on save", () => {
    expect(() => createFor(MARK, townhouse(), content({ taskId: WALLS, reportedProgress: 101 }))).toThrow(
      expect.objectContaining({ code: "PROGRESS_OUT_OF_RANGE" }),
    );
  });

  it("BR-5 accepts progress below approved progress on save", () => {
    const report = createFor(MARK, townhouse(), content({ taskId: WALLS, reportedProgress: 30 }));

    expect(report.items[0]?.reportedProgress).toBe(30);
  });

  it("BR-6 rejects edits by another foreman", () => {
    const report = aReport().by(MARK.id).build();

    expect(() => report.edit(HENRY, townhouse(), content())).toThrow(ForbiddenError);
    expect(() => report.edit(HENRY, townhouse(), content())).toThrow(
      expect.objectContaining({ code: "NOT_REPORT_AUTHOR" }),
    );
  });

  it.each([
    ["SUBMITTED", aReport().by(MARK.id).submitted().build()],
    ["APPROVED", aReport().by(MARK.id).approved().build()],
  ])("BR-6 rejects edits in %s, stating the status", (status, report) => {
    expect(() => report.edit(MARK, townhouse(), content())).toThrow(ConflictError);
    expect(() => report.edit(MARK, townhouse(), content())).toThrow(
      expect.objectContaining({ code: "REPORT_NOT_EDITABLE", details: { status } }),
    );
  });

  it("BR-6 allows edits in REJECTED and keeps the status", () => {
    const report = aReport().by(MARK.id).rejected().withItems({ taskId: WALLS, reportedProgress: 55 }).build();

    const edited = report.edit(MARK, townhouse(), content({ taskId: WALLS, reportedProgress: 50 }));

    expect(edited.status).toBe(ReportStatus.REJECTED);
    expect(edited.items[0]?.reportedProgress).toBe(50);
  });

  it("BR-7 allows saving a draft with no items", () => {
    const report = createFor(MARK, townhouse(), content());

    expect(report.items).toEqual([]);
  });

  it("a site supervisor cannot create or edit a report", () => {
    const report = aReport().by(MARK.id).build();

    expect(() => createFor(LINDA, townhouse(), content())).toThrow(
      expect.objectContaining({ code: "ROLE_CANNOT_AUTHOR_REPORTS" }),
    );
    expect(() => report.edit(LINDA, townhouse(), content())).toThrow(
      expect.objectContaining({ code: "ROLE_CANNOT_AUTHOR_REPORTS" }),
    );
  });

  it("edit replaces the whole item list and the note, so a left-out task is gone", () => {
    const report = aReport()
      .by(MARK.id)
      .withItems({ taskId: FOUNDATION, reportedProgress: 100 }, { taskId: WALLS, reportedProgress: 55 })
      .build();

    const edited = report.edit(MARK, townhouse(), { ...content({ taskId: WALLS, reportedProgress: 55 }), note: "n" });

    expect(edited.items.map((item) => item.taskId)).toEqual([WALLS]);
    expect(edited.note).toBe("n");
    expect(edited.version).toBe(report.version);
  });
});

describe("submit", () => {
  const At = new Date("2026-11-20T10:05:00Z");

  function draftWithWalls(progress: number): DailyReport {
    return aReport().by(MARK.id).withItems({ taskId: WALLS, reportedProgress: progress }).build();
  }

  it("BR-11 submitting records one transition with actor, time and no reason", () => {
    const submitted = draftWithWalls(55).submit(MARK, townhouse(), At);

    expect(submitted.status).toBe(ReportStatus.SUBMITTED);
    expect(submitted.transitions).toEqual([
      { from: ReportStatus.DRAFT, to: ReportStatus.SUBMITTED, actorId: MARK.id, occurredAt: At, reason: null },
    ]);
    expect(submitted.items).toEqual(draftWithWalls(55).items);
  });

  it("BR-11 resubmitting a REJECTED report records a transition from REJECTED", () => {
    const rejected = aReport().by(MARK.id).rejected().withItems({ taskId: WALLS, reportedProgress: 55 }).build();

    const submitted = rejected.submit(MARK, townhouse(), At);

    expect(submitted.transitions).toHaveLength(3);
    expect(submitted.transitions[2]).toEqual(
      expect.objectContaining({ from: ReportStatus.REJECTED, to: ReportStatus.SUBMITTED, actorId: MARK.id }),
    );
  });

  it("BR-7 rejects submitting a report with no items", () => {
    const empty = aReport().by(MARK.id).withNoItems().build();

    expect(() => empty.submit(MARK, townhouse(), At)).toThrow(expect.objectContaining({ code: "REPORT_HAS_NO_ITEMS" }));
  });

  it("BR-5 rejects reported progress below approved progress on submit, naming the task and its approved progress", () => {
    expect(() => draftWithWalls(30).submit(MARK, townhouse(), At)).toThrow(
      expect.objectContaining({
        code: "PROGRESS_BELOW_APPROVED",
        message: 'The reported progress for "Build ground-floor walls" is 30%, below its approved progress of 40%.',
        details: { taskId: WALLS, taskName: "Build ground-floor walls", reportedProgress: 30, approvedProgress: 40 },
      }),
    );
  });

  it("BR-5 accepts reported progress equal to approved progress", () => {
    expect(draftWithWalls(40).submit(MARK, townhouse(), At).status).toBe(ReportStatus.SUBMITTED);
  });

  it("BR-3 rejects submitting for a CLOSED worksite", () => {
    expect(() => draftWithWalls(55).submit(MARK, townhouse(aWorksite().closed()), At)).toThrow(
      expect.objectContaining({ code: "WORKSITE_CLOSED" }),
    );
  });

  it("BR-4 rejects submitting when a task has been reassigned to another foreman", () => {
    const reassigned = aWorksite()
      .supervisedBy(LINDA.id)
      .withTasks(aTask().withId(WALLS).named("Build ground-floor walls").assignedTo(HENRY.id).build())
      .build();

    expect(() => draftWithWalls(55).submit(MARK, reassigned, At)).toThrow(
      expect.objectContaining({
        code: "TASK_NOT_ASSIGNED_TO_AUTHOR",
        details: expect.objectContaining({ taskId: WALLS }),
      }),
    );
  });

  it("BR-6 rejects submission by another foreman", () => {
    expect(() => draftWithWalls(55).submit(HENRY, townhouse(), At)).toThrow(
      expect.objectContaining({ code: "NOT_REPORT_AUTHOR" }),
    );
  });

  it.each([
    ["SUBMITTED", aReport().by(MARK.id).submitted().withItems({ taskId: WALLS, reportedProgress: 55 }).build()],
    ["APPROVED", aReport().by(MARK.id).approved().withItems({ taskId: WALLS, reportedProgress: 55 }).build()],
  ])("BR-6 rejects submitting a %s report, stating the status", (status, report) => {
    expect(() => report.submit(MARK, townhouse(), At)).toThrow(
      expect.objectContaining({ code: "INVALID_STATUS_TRANSITION", details: { from: status, to: "SUBMITTED" } }),
    );
  });

  it("a site supervisor cannot submit", () => {
    expect(() => draftWithWalls(55).submit(LINDA, townhouse(), At)).toThrow(
      expect.objectContaining({ code: "ROLE_CANNOT_AUTHOR_REPORTS" }),
    );
  });
});

describe("who may view", () => {
  const sam: Actor = { id: toUserId("00000000-0000-4000-8000-000000000009"), role: Role.SITE_SUPERVISOR };
  const statusBuilders = {
    DRAFT: () => aReport().by(MARK.id).build(),
    SUBMITTED: () => aReport().by(MARK.id).submitted().build(),
    REJECTED: () => aReport().by(MARK.id).rejected().build(),
    APPROVED: () => aReport().by(MARK.id).approved().build(),
  } as const;
  const allStatuses = Object.keys(statusBuilders) as (keyof typeof statusBuilders)[];

  it.each(allStatuses)("FR-030 the author may view a %s report", (status) => {
    expect(() => statusBuilders[status]().assertViewableBy(MARK, townhouse())).not.toThrow();
  });

  it.each(["SUBMITTED", "REJECTED", "APPROVED"] as const)(
    "FR-030 the worksite's site supervisor may view a %s report",
    (status) => {
      expect(() => statusBuilders[status]().assertViewableBy(LINDA, townhouse())).not.toThrow();
    },
  );

  it("FR-030 the worksite's site supervisor may not view a DRAFT", () => {
    expect(() => statusBuilders.DRAFT().assertViewableBy(LINDA, townhouse())).toThrow(
      expect.objectContaining({ code: "REPORT_VIEW_FORBIDDEN" }),
    );
  });

  it.each(allStatuses)("FR-030 another foreman may not view a %s report", (status) => {
    const report = statusBuilders[status]();
    expect(() => report.assertViewableBy(HENRY, townhouse())).toThrow(ForbiddenError);
    expect(() => report.assertViewableBy(HENRY, townhouse())).toThrow(
      expect.objectContaining({ code: "REPORT_VIEW_FORBIDDEN", details: { reportId: report.id } }),
    );
  });

  it.each(allStatuses)("FR-030 the site supervisor of another worksite may not view a %s report", (status) => {
    expect(() => statusBuilders[status]().assertViewableBy(sam, townhouse())).toThrow(
      expect.objectContaining({ code: "REPORT_VIEW_FORBIDDEN" }),
    );
  });
});

describe("approve", () => {
  const approvedAt = new Date("2026-11-21T03:00:00Z");
  const sam: Actor = { id: toUserId("00000000-0000-4000-8000-000000000009"), role: Role.SITE_SUPERVISOR };

  function submittedWith(...items: { taskId: string; reportedProgress: number }[]): DailyReport {
    return aReport()
      .by(MARK.id)
      .withNote("Rain from 15:00.")
      .withItems(...items)
      .submitted()
      .build();
  }

  function refusalOf(attempt: () => unknown): unknown {
    try {
      attempt();
    } catch (error) {
      return error;
    }
    throw new Error("expected the attempt to be refused");
  }

  it("BR-11 approving records one transition SUBMITTED to APPROVED with the supervisor, the time and no reason", () => {
    const report = submittedWith({ taskId: WALLS, reportedProgress: 55 });

    const approved = report.approve(LINDA, townhouse(), approvedAt);

    expect(approved.status).toBe(ReportStatus.APPROVED);
    expect(approved.transitions).toEqual([
      ...report.transitions,
      {
        from: ReportStatus.SUBMITTED,
        to: ReportStatus.APPROVED,
        actorId: LINDA.id,
        occurredAt: approvedAt,
        reason: null,
      },
    ]);
    expect(approved.items).toEqual(report.items);
    expect(approved.note).toBe(report.note);
    expect(approved.version).toBe(report.version);
  });

  it.each([
    ["the author", MARK],
    ["another foreman", HENRY],
  ])("BR-12 rejects approval by a foreman: %s", (_who, actor) => {
    const report = submittedWith({ taskId: WALLS, reportedProgress: 55 });

    expect(() => report.approve(actor, townhouse(), approvedAt)).toThrow(ForbiddenError);
    expect(() => report.approve(actor, townhouse(), approvedAt)).toThrow(
      expect.objectContaining({ code: "REPORT_APPROVAL_FORBIDDEN", details: { reportId: report.id } }),
    );
  });

  it("BR-12 rejects approval by a supervisor of another worksite", () => {
    const report = submittedWith({ taskId: WALLS, reportedProgress: 55 });

    expect(() => report.approve(sam, townhouse(), approvedAt)).toThrow(
      expect.objectContaining({ code: "REPORT_APPROVAL_FORBIDDEN" }),
    );
  });

  it("rejects approval of a DRAFT with exactly the BR-12 refusal", () => {
    const draft = aReport().by(MARK.id).withItems({ taskId: WALLS, reportedProgress: 55 }).build();
    const submitted = aReport()
      .withId(draft.id)
      .by(MARK.id)
      .withItems({ taskId: WALLS, reportedProgress: 55 })
      .submitted()
      .build();

    const forDraft = refusalOf(() => draft.approve(LINDA, townhouse(), approvedAt));
    const forOtherSupervisor = refusalOf(() => submitted.approve(sam, townhouse(), approvedAt));

    expect(forDraft).toBeInstanceOf(ForbiddenError);
    expect(forDraft).toEqual(forOtherSupervisor);
    expect(forDraft).toMatchObject({ code: "REPORT_APPROVAL_FORBIDDEN" });
    expect((forDraft as ForbiddenError).message).toBe((forOtherSupervisor as ForbiddenError).message);
    expect((forDraft as ForbiddenError).details).toEqual((forOtherSupervisor as ForbiddenError).details);
  });

  it("BR-10 an APPROVED report cannot be approved again", () => {
    const report = aReport().by(MARK.id).withItems({ taskId: WALLS, reportedProgress: 55 }).approved().build();

    expect(() => report.approve(LINDA, townhouse(), approvedAt)).toThrow(
      expect.objectContaining({ code: "INVALID_STATUS_TRANSITION", details: { from: "APPROVED", to: "APPROVED" } }),
    );
  });

  it("BR-10 an APPROVED report cannot be edited", () => {
    const report = aReport().by(MARK.id).withItems({ taskId: WALLS, reportedProgress: 55 }).approved().build();

    expect(() => report.edit(MARK, townhouse(), content({ taskId: WALLS, reportedProgress: 60 }))).toThrow(
      expect.objectContaining({ code: "REPORT_NOT_EDITABLE", details: { status: "APPROVED" } }),
    );
  });

  it("BR-10 an APPROVED report cannot be submitted", () => {
    const report = aReport().by(MARK.id).withItems({ taskId: WALLS, reportedProgress: 55 }).approved().build();

    expect(() => report.submit(MARK, townhouse(), approvedAt)).toThrow(
      expect.objectContaining({ code: "INVALID_STATUS_TRANSITION", details: { from: "APPROVED", to: "SUBMITTED" } }),
    );
  });

  it("rejects approving a REJECTED report, stating the status", () => {
    const report = aReport().by(MARK.id).withItems({ taskId: WALLS, reportedProgress: 55 }).rejected().build();

    expect(() => report.approve(LINDA, townhouse(), approvedAt)).toThrow(
      expect.objectContaining({ code: "INVALID_STATUS_TRANSITION", details: { from: "REJECTED", to: "APPROVED" } }),
    );
  });

  it("BR-5 rejects approval when a task's approved progress is above the reported progress, naming the task and both figures", () => {
    const report = submittedWith({ taskId: WALLS, reportedProgress: 40 });
    const movedOn = townhouse(aWorksite()).tasks.map((task) =>
      task.id === WALLS
        ? aTask().withId(WALLS).named(task.name).assignedTo(MARK.id).withApprovedProgress(60).build()
        : task,
    );
    const worksite = aWorksite()
      .supervisedBy(LINDA.id)
      .withTasks(...movedOn)
      .build();

    expect(() => report.approve(LINDA, worksite, approvedAt)).toThrow(RuleViolationError);
    expect(() => report.approve(LINDA, worksite, approvedAt)).toThrow(
      expect.objectContaining({
        code: "REPORT_PROGRESS_OUTDATED",
        message:
          'This report cannot be approved: approved progress is already above it for 1 task. "Build ground-floor walls": reported 40%, approved 60%. Reject the report so its author can update it.',
        details: {
          tasks: [{ taskId: WALLS, taskName: "Build ground-floor walls", reportedProgress: 40, approvedProgress: 60 }],
        },
      }),
    );
  });

  it("BR-5 lists every outdated task, in item order", () => {
    const report = submittedWith({ taskId: WALLS, reportedProgress: 45 }, { taskId: FOUNDATION, reportedProgress: 90 });
    const worksite = aWorksite()
      .supervisedBy(LINDA.id)
      .withTasks(
        aTask().withId(FOUNDATION).named("Pour foundation").assignedTo(MARK.id).withApprovedProgress(100).build(),
        aTask().withId(WALLS).named("Build ground-floor walls").assignedTo(MARK.id).withApprovedProgress(50).build(),
      )
      .build();

    expect(() => report.approve(LINDA, worksite, approvedAt)).toThrow(
      expect.objectContaining({
        code: "REPORT_PROGRESS_OUTDATED",
        details: {
          tasks: [
            { taskId: WALLS, taskName: "Build ground-floor walls", reportedProgress: 45, approvedProgress: 50 },
            { taskId: FOUNDATION, taskName: "Pour foundation", reportedProgress: 90, approvedProgress: 100 },
          ],
        },
      }),
    );
  });

  it("BR-5 accepts reported progress equal to approved progress", () => {
    const report = submittedWith({ taskId: WALLS, reportedProgress: 40 });

    expect(report.approve(LINDA, townhouse(), approvedAt).status).toBe(ReportStatus.APPROVED);
  });

  it("FR-008 accepts a CLOSED worksite and a task now assigned to another foreman", () => {
    const report = submittedWith({ taskId: WALLS, reportedProgress: 55 });
    const closedAndReassigned = aWorksite()
      .supervisedBy(LINDA.id)
      .closed()
      .withTasks(
        aTask().withId(WALLS).named("Build ground-floor walls").assignedTo(HENRY.id).withApprovedProgress(40).build(),
      )
      .build();

    expect(report.approve(LINDA, closedAndReassigned, approvedAt).status).toBe(ReportStatus.APPROVED);
  });

  it("fails loudly when an item's task is not in the worksite", () => {
    const report = submittedWith({ taskId: ELECTRICAL, reportedProgress: 10 });
    const withoutElectrical = aWorksite().supervisedBy(LINDA.id).build();

    expect(() => report.approve(LINDA, withoutElectrical, approvedAt)).toThrow(
      `Report ${report.id} refers to task ${ELECTRICAL}, which is not in worksite ${withoutElectrical.id}`,
    );
  });
});
