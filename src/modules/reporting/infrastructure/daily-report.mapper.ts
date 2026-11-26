import type {
  DailyReport as DailyReportRow,
  ReportItem as ReportItemRow,
  ReportStatus as ReportStatusRow,
  ReportTransition as ReportTransitionRow,
} from "@prisma/client";
import { toUserId } from "../../../shared/domain/actor";
import { assertNever } from "../../../shared/domain/assert-never";
import { toTaskId, toWorksiteId } from "../../../shared/domain/ids";
import { toProgress } from "../../../shared/domain/progress";
import {
  DailyReport,
  ReportStatus,
  type ReportTransition,
  toReportId,
  toWorkDate,
  type WorkDate,
} from "../domain/daily-report";
import { ReportItem } from "../domain/report-item";

export type DailyReportWithChildrenRow = DailyReportRow & {
  readonly items: readonly ReportItemRow[];
  readonly transitions: readonly ReportTransitionRow[];
};

/** Rows to domain objects (ARC-08). Row IDs of transitions and all timestamps except occurredAt are not mapped. */
export function toDailyReport(row: DailyReportWithChildrenRow): DailyReport {
  return DailyReport.restore({
    id: toReportId(row.id),
    worksiteId: toWorksiteId(row.worksiteId),
    authorId: toUserId(row.authorId),
    workDate: fromDateColumn(row.workDate),
    status: toReportStatus(row.status),
    version: row.version,
    note: row.note,
    items: row.items.map(toReportItem),
    transitions: row.transitions.map(toTransition),
  });
}

/** A `date` column arrives as midnight UTC; the calendar date is its UTC date. */
export function fromDateColumn(value: Date): WorkDate {
  return toWorkDate(value.toISOString().slice(0, 10));
}

export function toDateColumn(workDate: WorkDate): Date {
  return new Date(`${workDate}T00:00:00Z`);
}

function toReportItem(row: ReportItemRow): ReportItem {
  return ReportItem.restore({
    taskId: toTaskId(row.taskId),
    // The report_items_reported_progress_range CHECK guarantees the range.
    reportedProgress: toProgress(row.reportedProgress),
    note: row.note,
  });
}

function toTransition(row: ReportTransitionRow): ReportTransition {
  return {
    from: toReportStatus(row.fromStatus),
    to: toReportStatus(row.toStatus),
    actorId: toUserId(row.actorId),
    occurredAt: row.occurredAt,
    reason: row.reason,
  };
}

function toReportStatus(status: ReportStatusRow): ReportStatus {
  switch (status) {
    case "DRAFT":
      return ReportStatus.DRAFT;
    case "SUBMITTED":
      return ReportStatus.SUBMITTED;
    case "REJECTED":
      return ReportStatus.REJECTED;
    case "APPROVED":
      return ReportStatus.APPROVED;
    default:
      return assertNever(status);
  }
}
