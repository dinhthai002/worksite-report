import type { Actor } from "../../../shared/domain/actor";
import type { Clock } from "../../../shared/domain/clock";
import type { WorksiteRepository } from "../../worksite";
import type { ReportId } from "../domain/daily-report";
import type { DailyReportRepository } from "../domain/daily-report.repository";
import { type ReportView, reportNotFound, toReportView } from "./get-report";
import { versionConflict } from "./save-draft";

export interface RejectReportInput {
  readonly actor: Actor;
  readonly reportId: ReportId;
  /** The version the caller last read (BR-15). */
  readonly expectedVersion: number;
  /** As sent; null when the request had none. BR-8 is decided by the domain. */
  readonly reason: string | null;
}

/**
 * UC-4 Reject a report: the worksite's site supervisor sends a SUBMITTED report back to its author with a reason. No
 * task changes. Checks run in the order of 004 research R1: existence, permission, version, status, reason. The write
 * is the existing conditional save (004 research R4).
 */
export class RejectReport {
  private readonly reports: DailyReportRepository;
  private readonly worksites: WorksiteRepository;
  private readonly clock: Clock;

  constructor(reports: DailyReportRepository, worksites: WorksiteRepository, clock: Clock) {
    this.reports = reports;
    this.worksites = worksites;
    this.clock = clock;
  }

  async execute(input: RejectReportInput): Promise<ReportView> {
    const report = await this.reports.findById(input.reportId);
    if (report === undefined) {
      throw reportNotFound(input.reportId);
    }
    const worksite = await this.worksites.findById(report.worksiteId);
    if (worksite === undefined) {
      throw new Error(`Report ${report.id} refers to missing worksite ${report.worksiteId}`);
    }
    report.assertCanReject(input.actor, worksite);
    // BR-15: a stale copy is told to reload before the status is checked, so the loser of a race always gets a conflict.
    if (report.version !== input.expectedVersion) {
      throw versionConflict(input.expectedVersion, report.version);
    }
    const rejected = report.reject(input.actor, worksite, input.reason, this.clock.now());
    return toReportView(await this.reports.save(rejected, input.expectedVersion));
  }
}
