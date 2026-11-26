import type { Actor } from "../../../shared/domain/actor";
import type { Clock } from "../../../shared/domain/clock";
import type { WorksiteRepository } from "../../worksite";
import type { ReportId } from "../domain/daily-report";
import type { DailyReportRepository } from "../domain/daily-report.repository";
import { type ReportView, reportNotFound, toReportView } from "./get-report";
import { versionConflict } from "./save-draft";

export interface ApproveReportInput {
  readonly actor: Actor;
  readonly reportId: ReportId;
  /** The version the caller last read (BR-15). */
  readonly expectedVersion: number;
}

/**
 * UC-3 Approve a report: the worksite's site supervisor approves a SUBMITTED report, and every item's task gets its
 * reported progress, together or not at all (BR-9, ADR 0004). Checks run in the order of research R1: existence,
 * permission, version, status, progress.
 */
export class ApproveReport {
  private readonly reports: DailyReportRepository;
  private readonly worksites: WorksiteRepository;
  private readonly clock: Clock;

  constructor(reports: DailyReportRepository, worksites: WorksiteRepository, clock: Clock) {
    this.reports = reports;
    this.worksites = worksites;
    this.clock = clock;
  }

  async execute(input: ApproveReportInput): Promise<ReportView> {
    const report = await this.reports.findById(input.reportId);
    if (report === undefined) {
      throw reportNotFound(input.reportId);
    }
    const worksite = await this.worksites.findById(report.worksiteId);
    if (worksite === undefined) {
      throw new Error(`Report ${report.id} refers to missing worksite ${report.worksiteId}`);
    }
    report.assertCanApprove(input.actor, worksite);
    // BR-15: a stale copy is told to reload before the status is checked, so the loser of a race always gets a conflict.
    if (report.version !== input.expectedVersion) {
      throw versionConflict(input.expectedVersion, report.version);
    }
    const approved = report.approve(input.actor, worksite, this.clock.now());
    return toReportView(await this.reports.saveApproval(approved, input.expectedVersion));
  }
}
