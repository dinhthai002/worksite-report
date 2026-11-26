import { type Actor, Role, type UserId } from "../../../shared/domain/actor";
import { ConflictError, ForbiddenError, RuleViolationError } from "../../../shared/domain/errors";
import type { TaskId, WorksiteId } from "../../../shared/domain/ids";
import type { Progress } from "../../../shared/domain/progress";
import { ReportItem } from "./report-item";

declare const reportIdBrand: unique symbol;

/** ID of a daily report (TS-08). */
export type ReportId = string & { readonly [reportIdBrand]: true };

export function toReportId(value: string): ReportId {
  return value as ReportId;
}

/** Status of a daily report (glossary). */
export const ReportStatus = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  REJECTED: "REJECTED",
  APPROVED: "APPROVED",
} as const;

export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

/** The four valid transitions of the report lifecycle (PRD, Report lifecycle). Every other pair is refused. */
export const ALLOWED_TRANSITIONS: readonly (readonly [from: ReportStatus, to: ReportStatus])[] = [
  [ReportStatus.DRAFT, ReportStatus.SUBMITTED],
  [ReportStatus.SUBMITTED, ReportStatus.APPROVED],
  [ReportStatus.SUBMITTED, ReportStatus.REJECTED],
  [ReportStatus.REJECTED, ReportStatus.SUBMITTED],
];

export function canTransition(from: ReportStatus, to: ReportStatus): boolean {
  return ALLOWED_TRANSITIONS.some(([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to);
}

/** The verb for a transition to each status. A Record keyed by the union is exhaustive, like a switch (TS-05). */
const VERB_FOR: Readonly<Record<ReportStatus, string>> = {
  DRAFT: "returned to DRAFT",
  SUBMITTED: "submitted",
  REJECTED: "rejected",
  APPROVED: "approved",
};

/** FR-018: throws INVALID_STATUS_TRANSITION, naming the current status, for any pair outside the lifecycle. */
export function assertTransition(from: ReportStatus, to: ReportStatus): void {
  if (canTransition(from, to)) {
    return;
  }
  const allowedFrom = ALLOWED_TRANSITIONS.filter(([, allowedTo]) => allowedTo === to).map(([status]) => status);
  const hint = allowedFrom.length === 0 ? "No report can be." : `Only a ${allowedFrom.join(" or ")} report can be.`;
  throw new ConflictError("INVALID_STATUS_TRANSITION", `A ${from} report cannot be ${VERB_FOR[to]}. ${hint}`, {
    from,
    to,
  });
}

/** BR-6: a report can be changed only while it is DRAFT or REJECTED. */
export function isEditable(status: ReportStatus): boolean {
  return status === ReportStatus.DRAFT || status === ReportStatus.REJECTED;
}

declare const workDateBrand: unique symbol;

/** The calendar date a report describes, `YYYY-MM-DD`, with no time component (glossary). */
export type WorkDate = string & { readonly [workDateBrand]: true };

export function toWorkDate(value: string): WorkDate {
  return value as WorkDate;
}

/** A recorded change of report status: who, when, and why (BR-11). Permanent once stored. */
export interface ReportTransition {
  readonly from: ReportStatus;
  readonly to: ReportStatus;
  readonly actorId: UserId;
  readonly occurredAt: Date;
  readonly reason: string | null;
}

/** What a report needs to know about one task of its worksite. */
export interface ReportTask {
  readonly id: TaskId;
  readonly name: string;
  readonly approvedProgress: Progress;
  isAssignedTo(userId: UserId): boolean;
}

/**
 * What a report needs to know about its worksite. The worksite module's Worksite fits this structurally, so the use
 * cases pass it in unchanged; this module's domain may not import it (ARC-01, research R2).
 */
export interface ReportWorksite {
  readonly id: WorksiteId;
  readonly status: "ACTIVE" | "CLOSED";
  readonly supervisorId: UserId;
  readonly tasks: readonly ReportTask[];
}

/**
 * Days since 1970-01-01 for a proleptic Gregorian calendar date, and back (H. Hinnant's days_from_civil and
 * civil_from_days). Pure integer arithmetic on the calendar date: no time of day, no time zone, and no Date, which
 * ARC-10 keeps out of the domain.
 */
function dayNumber(date: string): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const year = m <= 2 ? y - 1 : y;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function fromDayNumber(days: number): string {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(date) + days);
}

/**
 * BR-2: a report can be created only for a work date from `limitDays` before today up to today, both included.
 * `today` comes from Clock.today(), already resolved in the configured time zone (research R7).
 */
export function assertCanCreateReportFor(workDate: WorkDate, today: string, limitDays: number): void {
  const earliest = addDays(today, -limitDays);
  const latest = today;
  if (workDate < earliest || workDate > latest) {
    throw new RuleViolationError(
      "WORK_DATE_OUT_OF_RANGE",
      `The work date ${workDate} is outside the allowed range ${earliest} to ${latest}.`,
      { workDate, earliest, latest },
    );
  }
}

/** One item as a foreman enters it, before the rules are checked. */
export interface DraftItemInput {
  readonly taskId: TaskId;
  readonly reportedProgress: number;
  readonly note: string | null;
}

/** The whole content of a save: it replaces the report's note and items (FR-002). */
export interface DraftContent {
  readonly note: string | null;
  readonly items: readonly DraftItemInput[];
}

export interface CreateReportInput {
  readonly id: ReportId;
  readonly author: Actor;
  readonly worksite: ReportWorksite;
  readonly workDate: WorkDate;
  /** Clock.today(), `YYYY-MM-DD` in the configured time zone. */
  readonly today: string;
  readonly backdateLimitDays: number;
  readonly content: DraftContent;
}

// BR-3: reports can be created and submitted only for an ACTIVE worksite.
function assertWorksiteActive(worksite: ReportWorksite): void {
  if (worksite.status !== "ACTIVE") {
    throw new RuleViolationError(
      "WORKSITE_CLOSED",
      `The worksite ${worksite.id} is closed. Reports can be created and submitted only for an active worksite.`,
      { worksiteId: worksite.id },
    );
  }
}

// BR-4: the task belongs to the report's worksite and is currently assigned to the report's author.
function taskOfAuthor(worksite: ReportWorksite, authorId: UserId, taskId: TaskId): ReportTask {
  const task = worksite.tasks.find((candidate) => candidate.id === taskId);
  if (task === undefined) {
    throw new RuleViolationError(
      "TASK_NOT_IN_WORKSITE",
      `The task ${taskId} is not a task of worksite ${worksite.id}.`,
      { taskId, worksiteId: worksite.id },
    );
  }
  if (!task.isAssignedTo(authorId)) {
    throw new RuleViolationError(
      "TASK_NOT_ASSIGNED_TO_AUTHOR",
      `The task "${task.name}" (${task.id}) is not assigned to you.`,
      { taskId: task.id, taskName: task.name },
    );
  }
  return task;
}

/** BR-4 for every item, in order, then BR-5's range through ReportItem.create. */
function toItems(worksite: ReportWorksite, authorId: UserId, inputs: readonly DraftItemInput[]): ReportItem[] {
  const seen = new Set<TaskId>();
  return inputs.map((input) => {
    // BR-4: a task appears at most once in a report.
    if (seen.has(input.taskId)) {
      throw new RuleViolationError("TASK_LISTED_TWICE", `The task ${input.taskId} is listed more than once.`, {
        taskId: input.taskId,
      });
    }
    seen.add(input.taskId);
    const task = taskOfAuthor(worksite, authorId, input.taskId);
    return ReportItem.create(task.id, input.reportedProgress, input.note);
  });
}

export interface DailyReportProps {
  readonly id: ReportId;
  readonly worksiteId: WorksiteId;
  readonly authorId: UserId;
  readonly workDate: WorkDate;
  readonly status: ReportStatus;
  readonly version: number;
  readonly note: string | null;
  readonly items: readonly ReportItem[];
  /** Oldest first. */
  readonly transitions: readonly ReportTransition[];
}

/**
 * One foreman's record of progress for one worksite on one work date (glossary). Aggregate root. Immutable: every
 * change returns a new DailyReport. The version is never changed here; the repository increments it on every write
 * (BR-15, research R10).
 */
export class DailyReport {
  readonly id: ReportId;
  readonly worksiteId: WorksiteId;
  readonly authorId: UserId;
  readonly workDate: WorkDate;
  readonly status: ReportStatus;
  readonly version: number;
  readonly note: string | null;
  readonly items: readonly ReportItem[];
  readonly transitions: readonly ReportTransition[];

  private constructor(props: DailyReportProps) {
    this.id = props.id;
    this.worksiteId = props.worksiteId;
    this.authorId = props.authorId;
    this.workDate = props.workDate;
    this.status = props.status;
    this.version = props.version;
    this.note = props.note;
    this.items = [...props.items];
    this.transitions = [...props.transitions];
  }

  /** Rebuilds a report from stored data. */
  static restore(props: DailyReportProps): DailyReport {
    return new DailyReport(props);
  }

  /** PRD, Roles: only a foreman creates, edits and submits reports. */
  static assertCanAuthor(actor: Actor): void {
    if (actor.role !== Role.FOREMAN) {
      throw new ForbiddenError("ROLE_CANNOT_AUTHOR_REPORTS", "Only a foreman can create, edit or submit a report.", {
        role: actor.role,
      });
    }
  }

  /** UC-1, first save: a new DRAFT report, version 1, with no transitions (FR-019). */
  static create(input: CreateReportInput): DailyReport {
    DailyReport.assertCanAuthor(input.author);
    assertCanCreateReportFor(input.workDate, input.today, input.backdateLimitDays);
    assertWorksiteActive(input.worksite);
    const items = toItems(input.worksite, input.author.id, input.content.items);
    return new DailyReport({
      id: input.id,
      worksiteId: input.worksite.id,
      authorId: input.author.id,
      workDate: input.workDate,
      status: ReportStatus.DRAFT,
      version: 1,
      note: input.content.note,
      items,
      transitions: [],
    });
  }

  /**
   * UC-1, a later save: replaces the note and the whole item list (FR-002). The status does not change. BR-2 is not
   * checked again: the backdating limit applies when a report is created (spec, Assumptions).
   */
  edit(actor: Actor, worksite: ReportWorksite, content: DraftContent): DailyReport {
    DailyReport.assertCanAuthor(actor);
    this.assertAuthor(actor);
    // BR-6: only while DRAFT or REJECTED.
    if (!isEditable(this.status)) {
      throw new ConflictError(
        "REPORT_NOT_EDITABLE",
        `The report is ${this.status}. Only a DRAFT or REJECTED report can be changed.`,
        { status: this.status },
      );
    }
    assertWorksiteActive(worksite);
    const items = toItems(worksite, this.authorId, content.items);
    return this.with({ note: content.note, items });
  }

  /**
   * UC-2: hands the report over for review. Records the transition (BR-11). Items are unchanged, and no task's
   * approved progress changes (FR-016): that happens only on approval.
   */
  submit(actor: Actor, worksite: ReportWorksite, at: Date): DailyReport {
    DailyReport.assertCanAuthor(actor);
    this.assertAuthor(actor);
    assertTransition(this.status, ReportStatus.SUBMITTED);
    assertWorksiteActive(worksite);
    // BR-7: at least one item to be submitted.
    if (this.items.length === 0) {
      throw new RuleViolationError("REPORT_HAS_NO_ITEMS", "A report needs at least one item to be submitted.");
    }
    for (const item of this.items) {
      // BR-4 again: the task may have been reassigned since the save.
      const task = taskOfAuthor(worksite, this.authorId, item.taskId);
      // BR-5: reported progress is at least the task's current approved progress.
      if (item.reportedProgress < task.approvedProgress) {
        throw new RuleViolationError(
          "PROGRESS_BELOW_APPROVED",
          `The reported progress for "${task.name}" is ${item.reportedProgress}%, below its approved progress of ${task.approvedProgress}%.`,
          {
            taskId: task.id,
            taskName: task.name,
            reportedProgress: item.reportedProgress,
            approvedProgress: task.approvedProgress,
          },
        );
      }
    }
    // BR-11: who, when, and no reason for a submission.
    const transition: ReportTransition = {
      from: this.status,
      to: ReportStatus.SUBMITTED,
      actorId: actor.id,
      occurredAt: at,
      reason: null,
    };
    return this.with({ status: ReportStatus.SUBMITTED, transitions: [...this.transitions, transition] });
  }

  /**
   * BR-6: only the author changes or submits a report. Public so a use case can check it before comparing versions
   * (research R4: permission for the report comes before the version).
   */
  assertAuthor(actor: Actor): void {
    if (actor.id !== this.authorId) {
      throw new ForbiddenError("NOT_REPORT_AUTHOR", `Only the author of report ${this.id} can change or submit it.`, {
        reportId: this.id,
      });
    }
  }

  /**
   * FR-030, UC-5: the author may view the report in any status; the worksite's site supervisor once it is submitted;
   * nobody else.
   */
  assertViewableBy(actor: Actor, worksite: ReportWorksite): void {
    if (actor.id === this.authorId) {
      return;
    }
    if (actor.id === worksite.supervisorId && this.status !== ReportStatus.DRAFT) {
      return;
    }
    throw new ForbiddenError(
      "REPORT_VIEW_FORBIDDEN",
      "You may not view this report. Only its author, and the worksite's site supervisor once it is submitted, may view it.",
      { reportId: this.id },
    );
  }

  private with(changes: Partial<DailyReportProps>): DailyReport {
    return new DailyReport({ ...this.props(), ...changes });
  }

  private props(): DailyReportProps {
    return {
      id: this.id,
      worksiteId: this.worksiteId,
      authorId: this.authorId,
      workDate: this.workDate,
      status: this.status,
      version: this.version,
      note: this.note,
      items: this.items,
      transitions: this.transitions,
    };
  }
}
