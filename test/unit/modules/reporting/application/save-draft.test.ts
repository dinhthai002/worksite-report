import { SaveDraft, type SaveDraftInput } from "@src/modules/reporting/application/save-draft";
import { ReportStatus, toReportId, toWorkDate } from "@src/modules/reporting/domain/daily-report";
import type { Worksite } from "@src/modules/worksite";
import { type Actor, Role, toUserId } from "@src/shared/domain/actor";
import { toTaskId, toWorksiteId } from "@src/shared/domain/ids";
import { FixedClock } from "../../../../fakes/fixed-clock";
import { InMemoryDailyReportRepository } from "../../../../fakes/in-memory-daily-report.repository";
import { InMemoryWorksiteRepository } from "../../../../fakes/in-memory-worksite.repository";
import { aTask, aWorksite } from "../../../../support/worksite.builder";

const MARK: Actor = { id: toUserId("00000000-0000-4000-8000-000000000002"), role: Role.FOREMAN };
const LINDA: Actor = { id: toUserId("00000000-0000-4000-8000-000000000001"), role: Role.SITE_SUPERVISOR };
const TOWNHOUSE = toWorksiteId("00000000-0000-4000-8000-000000000101");
const WALLS = "00000000-0000-4000-8000-000000000202";
const FOUNDATION = "00000000-0000-4000-8000-000000000201";
/** 10:00 on 21 November 2026 in Asia/Ho_Chi_Minh. */
const NOV_21 = "2026-11-21T03:00:00Z";

function townhouse(): Worksite {
  return aWorksite()
    .withId(TOWNHOUSE)
    .supervisedBy(LINDA.id)
    .withTasks(
      aTask().withId(FOUNDATION).assignedTo(MARK.id).withApprovedProgress(100).build(),
      aTask().withId(WALLS).assignedTo(MARK.id).withApprovedProgress(40).build(),
    )
    .build();
}

function setUp(clock = new FixedClock(NOV_21)): { saveDraft: SaveDraft; reports: InMemoryDailyReportRepository } {
  const reports = new InMemoryDailyReportRepository();
  const saveDraft = new SaveDraft(reports, new InMemoryWorksiteRepository([townhouse()]), clock, 365);
  return { saveDraft, reports };
}

function input(overrides: Partial<SaveDraftInput> = {}): SaveDraftInput {
  return {
    actor: MARK,
    worksiteId: TOWNHOUSE,
    workDate: toWorkDate("2026-11-20"),
    note: null,
    items: [{ taskId: toTaskId(WALLS), reportedProgress: 55, note: null }],
    ...overrides,
  };
}

describe("SaveDraft", () => {
  it("creates a DRAFT report with version 1", async () => {
    const { saveDraft } = setUp();

    const result = await saveDraft.execute(input());

    expect(result.created).toBe(true);
    expect(result.report).toEqual(
      expect.objectContaining({
        worksiteId: TOWNHOUSE,
        authorId: MARK.id,
        workDate: "2026-11-20",
        status: ReportStatus.DRAFT,
        version: 1,
        items: [{ taskId: WALLS, reportedProgress: 55, note: null }],
        transitions: [],
      }),
    );
  });

  it("BR-1 saving again without a version returns the existing report unchanged", async () => {
    const { saveDraft, reports } = setUp();
    const first = await saveDraft.execute(input());

    const again = await saveDraft.execute(
      input({ items: [{ taskId: toTaskId(WALLS), reportedProgress: 99, note: null }] }),
    );

    expect(again).toEqual({ created: false, report: first.report });
    expect(reports.count()).toBe(1);
  });

  it("BR-1 returns the existing report even when its work date is now outside the limit", async () => {
    const clock = new FixedClock(NOV_21);
    const { saveDraft } = setUp(clock);
    const first = await saveDraft.execute(input());
    clock.setTo("2028-01-01T03:00:00Z");

    const again = await saveDraft.execute(input());

    expect(again).toEqual({ created: false, report: first.report });
  });

  it("saving with the current version replaces the note and the whole item list", async () => {
    const { saveDraft } = setUp();
    await saveDraft.execute(
      input({
        items: [
          { taskId: toTaskId(FOUNDATION), reportedProgress: 100, note: null },
          { taskId: toTaskId(WALLS), reportedProgress: 55, note: null },
        ],
      }),
    );

    const saved = await saveDraft.execute(
      input({
        expectedVersion: 1,
        note: "Rain from 15:00.",
        items: [{ taskId: toTaskId(WALLS), reportedProgress: 60, note: null }],
      }),
    );

    expect(saved.created).toBe(false);
    expect(saved.report).toEqual(
      expect.objectContaining({
        version: 2,
        note: "Rain from 15:00.",
        items: [{ taskId: WALLS, reportedProgress: 60, note: null }],
      }),
    );
  });

  it("BR-2 today follows the configured time zone", async () => {
    const instant = "2026-11-20T18:30:00Z";
    const inVietnam = setUp(new FixedClock(instant, "Asia/Ho_Chi_Minh")).saveDraft;
    const inUtc = setUp(new FixedClock(instant, "UTC")).saveDraft;

    await expect(inVietnam.execute(input({ workDate: toWorkDate("2026-11-21") }))).resolves.toEqual(
      expect.objectContaining({ created: true }),
    );
    await expect(inUtc.execute(input({ workDate: toWorkDate("2026-11-21") }))).rejects.toThrow(
      expect.objectContaining({ code: "WORK_DATE_OUT_OF_RANGE" }),
    );
  });

  it("BR-15 rejects a save with a stale version, giving the current version", async () => {
    const { saveDraft } = setUp();
    await saveDraft.execute(input());
    await saveDraft.execute(input({ expectedVersion: 1 }));

    await expect(saveDraft.execute(input({ expectedVersion: 1 }))).rejects.toThrow(
      expect.objectContaining({
        code: "REPORT_VERSION_CONFLICT",
        details: { expectedVersion: 1, currentVersion: 2 },
      }),
    );
  });

  it("BR-15 rejects a version when the caller has no report, with currentVersion null", async () => {
    const { saveDraft } = setUp();

    await expect(saveDraft.execute(input({ expectedVersion: 1 }))).rejects.toThrow(
      expect.objectContaining({
        code: "REPORT_VERSION_CONFLICT",
        details: { expectedVersion: 1, currentVersion: null },
      }),
    );
  });

  it("refuses an unknown worksite", async () => {
    const { saveDraft } = setUp();
    const unknown = toWorksiteId("00000000-0000-4000-8000-000000000999");

    await expect(saveDraft.execute(input({ worksiteId: unknown }))).rejects.toThrow(
      expect.objectContaining({ code: "WORKSITE_NOT_FOUND", details: { worksiteId: unknown } }),
    );
  });

  it("refuses a site supervisor before looking up the worksite", async () => {
    const { saveDraft } = setUp();
    const unknown = toWorksiteId("00000000-0000-4000-8000-000000000999");

    await expect(saveDraft.execute(input({ actor: LINDA, worksiteId: unknown }))).rejects.toThrow(
      expect.objectContaining({ code: "ROLE_CANNOT_AUTHOR_REPORTS" }),
    );
  });

  it("a refused save leaves the stored report unchanged", async () => {
    const { saveDraft, reports } = setUp();
    const first = await saveDraft.execute(input());

    await expect(
      saveDraft.execute(
        input({ expectedVersion: 1, items: [{ taskId: toTaskId(WALLS), reportedProgress: 101, note: null }] }),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "PROGRESS_OUT_OF_RANGE" }));

    const stored = reports.stored(toReportId(first.report.id));
    expect(stored?.version).toBe(1);
    expect(stored?.items.map((item) => item.reportedProgress)).toEqual([55]);
  });
});
