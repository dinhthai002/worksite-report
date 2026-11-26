import type { UserId } from "../../../shared/domain/actor";
import type { WorksiteId } from "../../../shared/domain/ids";
import type { DailyReport, ReportId, WorkDate } from "./daily-report";

export interface AddResult {
  /** False when the author already had a report for the worksite and work date (BR-1). */
  readonly created: boolean;
  readonly report: DailyReport;
}

/**
 * Loads and stores daily reports with their items and transitions. Loaded items are listed last changed first,
 * transitions oldest first (FR-032).
 */
export interface DailyReportRepository {
  findById(id: ReportId): Promise<DailyReport | undefined>;

  findByAuthorWorksiteAndDate(
    authorId: UserId,
    worksiteId: WorksiteId,
    workDate: WorkDate,
  ): Promise<DailyReport | undefined>;

  /** Inserts a new report and its items. On BR-1's unique key, returns the existing report with created: false. */
  add(report: DailyReport): Promise<AddResult>;

  /**
   * Writes the report conditionally on expectedVersion and increments its version (BR-15). Throws
   * REPORT_VERSION_CONFLICT when the stored version differs. Returns the report as stored.
   */
  save(report: DailyReport, expectedVersion: number): Promise<DailyReport>;

  /**
   * Writes an approval in one transaction (ADR 0004, BR-9): the report conditionally on expectedVersion and status
   * SUBMITTED (BR-15), each task's approved progress raised to the reported progress only when below it, in ascending
   * task ID order, a task not raised checked not to be above it (BR-5 guard), and the new transition (BR-11). A task
   * already at the reported value is not written. Any failed condition rolls back everything. Throws
   * REPORT_VERSION_CONFLICT or REPORT_PROGRESS_OUTDATED. Returns the report as stored.
   */
  saveApproval(report: DailyReport, expectedVersion: number): Promise<DailyReport>;
}
