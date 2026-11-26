import { DailyReport, type ReportId, type WorkDate } from "@src/modules/reporting/domain/daily-report";
import type { AddResult, DailyReportRepository } from "@src/modules/reporting/domain/daily-report.repository";
import type { UserId } from "@src/shared/domain/actor";
import { ConflictError } from "@src/shared/domain/errors";
import type { WorksiteId } from "@src/shared/domain/ids";

/** In-memory DailyReportRepository for unit tests (TST-06). Mirrors BR-1 and BR-15 as the real one does. */
export class InMemoryDailyReportRepository implements DailyReportRepository {
  private readonly reports = new Map<ReportId, DailyReport>();

  constructor(reports: readonly DailyReport[] = []) {
    for (const report of reports) {
      this.reports.set(report.id, report);
    }
  }

  findById(id: ReportId): Promise<DailyReport | undefined> {
    return Promise.resolve(this.reports.get(id));
  }

  findByAuthorWorksiteAndDate(
    authorId: UserId,
    worksiteId: WorksiteId,
    workDate: WorkDate,
  ): Promise<DailyReport | undefined> {
    return Promise.resolve(
      [...this.reports.values()].find(
        (report) => report.authorId === authorId && report.worksiteId === worksiteId && report.workDate === workDate,
      ),
    );
  }

  async add(report: DailyReport): Promise<AddResult> {
    const existing = await this.findByAuthorWorksiteAndDate(report.authorId, report.worksiteId, report.workDate);
    if (existing !== undefined) {
      return { created: false, report: existing };
    }
    const stored = DailyReport.restore({ ...propsOf(report), version: 1 });
    this.reports.set(stored.id, stored);
    return { created: true, report: stored };
  }

  save(report: DailyReport, expectedVersion: number): Promise<DailyReport> {
    const current = this.reports.get(report.id);
    if (current === undefined || current.version !== expectedVersion) {
      const currentVersion = current?.version ?? null;
      return Promise.reject(
        new ConflictError("REPORT_VERSION_CONFLICT", "The report has changed since you read it.", {
          expectedVersion,
          currentVersion,
        }),
      );
    }
    const stored = DailyReport.restore({ ...propsOf(report), version: expectedVersion + 1 });
    this.reports.set(stored.id, stored);
    return Promise.resolve(stored);
  }

  /** The stored report, for assertions. */
  stored(id: ReportId): DailyReport | undefined {
    return this.reports.get(id);
  }

  count(): number {
    return this.reports.size;
  }
}

function propsOf(report: DailyReport): Parameters<typeof DailyReport.restore>[0] {
  return {
    id: report.id,
    worksiteId: report.worksiteId,
    authorId: report.authorId,
    workDate: report.workDate,
    status: report.status,
    version: report.version,
    note: report.note,
    items: report.items,
    transitions: report.transitions,
  };
}
