import { randomUUID } from "node:crypto";
import type { Actor } from "../../../shared/domain/actor";
import type { Clock } from "../../../shared/domain/clock";
import { ConflictError, NotFoundError } from "../../../shared/domain/errors";
import type { WorksiteId } from "../../../shared/domain/ids";
import type { WorksiteRepository } from "../../worksite";
import { DailyReport, type DraftItemInput, toReportId, type WorkDate } from "../domain/daily-report";
import type { DailyReportRepository } from "../domain/daily-report.repository";
import { type ReportView, toReportView } from "./get-report";

export interface SaveDraftInput {
  readonly actor: Actor;
  readonly worksiteId: WorksiteId;
  readonly workDate: WorkDate;
  /** The version the caller last read. Absent on a first save. */
  readonly expectedVersion?: number;
  readonly note: string | null;
  readonly items: readonly DraftItemInput[];
}

export interface SaveDraftResult {
  /** True only when this save created the report. */
  readonly created: boolean;
  readonly report: ReportView;
}

/** UC-1 Draft a report: create the caller's report for a worksite and work date, or replace its content. */
export class SaveDraft {
  private readonly reports: DailyReportRepository;
  private readonly worksites: WorksiteRepository;
  private readonly clock: Clock;
  private readonly backdateLimitDays: number;

  constructor(reports: DailyReportRepository, worksites: WorksiteRepository, clock: Clock, backdateLimitDays: number) {
    this.reports = reports;
    this.worksites = worksites;
    this.clock = clock;
    this.backdateLimitDays = backdateLimitDays;
  }

  async execute(input: SaveDraftInput): Promise<SaveDraftResult> {
    DailyReport.assertCanAuthor(input.actor);
    const worksite = await this.worksites.findById(input.worksiteId);
    if (worksite === undefined) {
      throw new NotFoundError("WORKSITE_NOT_FOUND", `There is no worksite with ID ${input.worksiteId}.`, {
        worksiteId: input.worksiteId,
      });
    }
    const content = { note: input.note, items: input.items };
    const existing = await this.reports.findByAuthorWorksiteAndDate(input.actor.id, input.worksiteId, input.workDate);

    if (input.expectedVersion === undefined) {
      if (existing !== undefined) {
        // BR-1: return the existing report, unchanged. The request's content is not applied.
        return { created: false, report: toReportView(existing) };
      }
      const report = DailyReport.create({
        id: toReportId(randomUUID()),
        author: input.actor,
        worksite,
        workDate: input.workDate,
        today: this.clock.today(),
        backdateLimitDays: this.backdateLimitDays,
        content,
      });
      const added = await this.reports.add(report);
      return { created: added.created, report: toReportView(added.report) };
    }

    if (existing === undefined) {
      throw new ConflictError(
        "REPORT_VERSION_CONFLICT",
        "You have no report for this worksite and date. Reload it and save without a version.",
        { expectedVersion: input.expectedVersion, currentVersion: null },
      );
    }
    // BR-15: answer a stale copy before checking any rule; the repository's conditional write is the guard.
    if (existing.version !== input.expectedVersion) {
      throw versionConflict(input.expectedVersion, existing.version);
    }
    const saved = await this.reports.save(existing.edit(input.actor, worksite, content), input.expectedVersion);
    return { created: false, report: toReportView(saved) };
  }
}

export function versionConflict(expectedVersion: number, currentVersion: number): ConflictError {
  return new ConflictError(
    "REPORT_VERSION_CONFLICT",
    `The report has changed since you read it (your version ${expectedVersion}, current version ${currentVersion}). Reload it and try again.`,
    { expectedVersion, currentVersion },
  );
}
