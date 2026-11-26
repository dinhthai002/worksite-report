import type { Actor } from "../../../shared/domain/actor";
import { NotFoundError } from "../../../shared/domain/errors";
import type { WorksiteRepository } from "../../worksite";
import type { DailyReport, ReportId, ReportStatus } from "../domain/daily-report";
import type { DailyReportRepository } from "../domain/daily-report.repository";

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

export function reportNotFound(reportId: ReportId): NotFoundError {
  return new NotFoundError("REPORT_NOT_FOUND", `There is no report with ID ${reportId}.`, { reportId });
}

export interface GetReportInput {
  readonly actor: Actor;
  readonly reportId: ReportId;
}

/** UC-5 View a report: the report with its items and transitions, to whoever may view it (FR-030 to FR-033). */
export class GetReport {
  private readonly reports: DailyReportRepository;
  private readonly worksites: WorksiteRepository;

  constructor(reports: DailyReportRepository, worksites: WorksiteRepository) {
    this.reports = reports;
    this.worksites = worksites;
  }

  async execute(input: GetReportInput): Promise<ReportView> {
    const report = await this.reports.findById(input.reportId);
    if (report === undefined) {
      throw reportNotFound(input.reportId);
    }
    const worksite = await this.worksites.findById(report.worksiteId);
    if (worksite === undefined) {
      throw new Error(`Report ${report.id} refers to missing worksite ${report.worksiteId}`);
    }
    report.assertViewableBy(input.actor, worksite);
    return toReportView(report);
  }
}
