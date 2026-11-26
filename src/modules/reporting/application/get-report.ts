import type { DailyReport, ReportStatus } from "../domain/daily-report";

/** A report item as the caller sees it. */
export interface ReportItemView {
  readonly taskId: string;
  readonly reportedProgress: number;
  readonly note: string | null;
}

/** A transition as the caller sees it. People are identified by user ID only (FR-031). */
export interface ReportTransitionView {
  readonly fromStatus: ReportStatus;
  readonly toStatus: ReportStatus;
  readonly actorId: string;
  /** ISO 8601 in UTC (research R14). */
  readonly occurredAt: string;
  readonly reason: string | null;
}

/** The report response shared by every report endpoint (contracts/report-view.md; FR-029, FR-031). */
export interface ReportView {
  readonly id: string;
  readonly worksiteId: string;
  readonly authorId: string;
  readonly workDate: string;
  readonly status: ReportStatus;
  readonly version: number;
  readonly note: string | null;
  readonly items: readonly ReportItemView[];
  readonly transitions: readonly ReportTransitionView[];
}

export function toReportView(report: DailyReport): ReportView {
  return {
    id: report.id,
    worksiteId: report.worksiteId,
    authorId: report.authorId,
    workDate: report.workDate,
    status: report.status,
    version: report.version,
    note: report.note,
    items: report.items.map(
      (item): ReportItemView => ({ taskId: item.taskId, reportedProgress: item.reportedProgress, note: item.note }),
    ),
    transitions: report.transitions.map(
      (transition): ReportTransitionView => ({
        fromStatus: transition.from,
        toStatus: transition.to,
        actorId: transition.actorId,
        occurredAt: transition.occurredAt.toISOString(),
        reason: transition.reason,
      }),
    ),
  };
}
