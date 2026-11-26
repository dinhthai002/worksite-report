import {
  DailyReport,
  type OutdatedItem,
  progressOutdated,
  type ReportId,
  ReportStatus,
  type WorkDate,
} from "@src/modules/reporting/domain/daily-report";
import type { AddResult, DailyReportRepository } from "@src/modules/reporting/domain/daily-report.repository";
import { Task, Worksite } from "@src/modules/worksite";
import type { UserId } from "@src/shared/domain/actor";
import { ConflictError } from "@src/shared/domain/errors";
import type { WorksiteId } from "@src/shared/domain/ids";
import type { InMemoryWorksiteRepository } from "./in-memory-worksite.repository";

/** In-memory DailyReportRepository for unit tests (TST-06). Mirrors BR-1 and BR-15 as the real one does. */
export class InMemoryDailyReportRepository implements DailyReportRepository {
  private readonly reports = new Map<ReportId, DailyReport>();
  private readonly worksites: InMemoryWorksiteRepository | undefined;

  /** `worksites` is needed only for saveApproval, which writes approved progress (ADR 0004). */
  constructor(reports: readonly DailyReport[] = [], worksites?: InMemoryWorksiteRepository) {
    this.worksites = worksites;
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

  /** All or nothing, as the real one: everything is checked before anything is written (BR-9). */
  async saveApproval(report: DailyReport, expectedVersion: number): Promise<DailyReport> {
    const current = this.reports.get(report.id);
    if (current === undefined || current.version !== expectedVersion || current.status !== ReportStatus.SUBMITTED) {
      throw new ConflictError("REPORT_VERSION_CONFLICT", "The report has changed since you read it.", {
        expectedVersion,
        currentVersion: current?.version ?? null,
      });
    }
    const worksite = await this.worksites?.findById(report.worksiteId);
    if (this.worksites === undefined || worksite === undefined) {
      throw new Error(`The fake has no worksite ${report.worksiteId}; pass an InMemoryWorksiteRepository`);
    }
    const outdated: OutdatedItem[] = [];
    for (const item of report.items) {
      const task = worksite.tasks.find((candidate) => candidate.id === item.taskId);
      if (task === undefined) {
        throw new Error(`Task ${item.taskId} is not in worksite ${worksite.id}`);
      }
      if (task.approvedProgress > item.reportedProgress) {
        outdated.push({
          taskId: task.id,
          taskName: task.name,
          reportedProgress: item.reportedProgress,
          approvedProgress: task.approvedProgress,
        });
      }
    }
    if (outdated.length > 0) {
      throw progressOutdated(outdated);
    }
    const reported = new Map(report.items.map((item) => [item.taskId, item.reportedProgress]));
    this.worksites.replace(
      Worksite.restore({
        id: worksite.id,
        name: worksite.name,
        supervisorId: worksite.supervisorId,
        status: worksite.status,
        tasks: worksite.tasks.map((task) =>
          Task.restore({
            id: task.id,
            name: task.name,
            assigneeId: task.assigneeId,
            approvedProgress: reported.get(task.id) ?? task.approvedProgress,
          }),
        ),
      }),
    );
    const stored = DailyReport.restore({ ...propsOf(report), version: expectedVersion + 1 });
    this.reports.set(stored.id, stored);
    return stored;
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
