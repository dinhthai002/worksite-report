import type { Actor } from "../../../shared/domain/actor";
import type { Clock } from "../../../shared/domain/clock";
import type { WorksiteRepository } from "../../worksite";
import { DailyReport, type ReportId } from "../domain/daily-report";
import type { DailyReportRepository } from "../domain/daily-report.repository";
import { type ReportView, reportNotFound, toReportView } from "./get-report";
import { versionConflict } from "./save-draft";

export interface SubmitReportInput {
  readonly actor: Actor;
  readonly reportId: ReportId;
  /** The version the caller last read (BR-15). */
  readonly expectedVersion: number;
}

/** UC-2 Submit a report: the author hands a DRAFT or REJECTED report over for review. */
export class SubmitReport {
  private readonly reports: DailyReportRepository;
  private readonly worksites: WorksiteRepository;
  private readonly clock: Clock;

  constructor(reports: DailyReportRepository, worksites: WorksiteRepository, clock: Clock) {
    this.reports = reports;
    this.worksites = worksites;
    this.clock = clock;
  }

  async execute(input: SubmitReportInput): Promise<ReportView> {
    DailyReport.assertCanAuthor(input.actor);
    const report = await this.reports.findById(input.reportId);
    if (report === undefined) {
      throw reportNotFound(input.reportId);
    }
    // BR-6 before BR-15 (research R4): another foreman is refused as not permitted, not told the current version.
    report.assertAuthor(input.actor);
    // BR-15: answer a stale copy before checking any rule; the repository's conditional write is the guard.
    if (report.version !== input.expectedVersion) {
      throw versionConflict(input.expectedVersion, report.version);
    }
    const worksite = await this.worksites.findById(report.worksiteId);
    if (worksite === undefined) {
      throw new Error(`Report ${report.id} refers to missing worksite ${report.worksiteId}`);
    }
    const submitted = report.submit(input.actor, worksite, this.clock.now());
    return toReportView(await this.reports.save(submitted, input.expectedVersion));
  }
}
