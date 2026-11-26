import { randomUUID } from "node:crypto";
import {
  DailyReport,
  ReportStatus,
  type ReportTransition,
  toReportId,
  toWorkDate,
} from "@src/modules/reporting/domain/daily-report";
import { ReportItem } from "@src/modules/reporting/domain/report-item";
import { toUserId, type UserId } from "@src/shared/domain/actor";
import { toTaskId, toWorksiteId, type WorksiteId } from "@src/shared/domain/ids";
import { toProgress } from "@src/shared/domain/progress";

export interface ItemInput {
  readonly taskId: string;
  readonly reportedProgress: number;
  readonly note?: string | null;
}

const SUBMITTED_AT = new Date("2026-11-20T10:00:00Z");
const REJECTED_AT = new Date("2026-11-21T01:00:00Z");
const APPROVED_AT = new Date("2026-11-21T03:00:00Z");

/** Builds a DailyReport with valid defaults: DRAFT, version 1, no items, no transitions (TST-10). */
export class DailyReportBuilder {
  private id = toReportId(randomUUID());
  private worksiteId: WorksiteId = toWorksiteId(randomUUID());
  private authorId: UserId = toUserId(randomUUID());
  private workDate = toWorkDate("2026-11-20");
  private status: ReportStatus = ReportStatus.DRAFT;
  private version = 1;
  private note: string | null = null;
  private items: ReportItem[] = [];
  private supervisorId: UserId = toUserId(randomUUID());

  withId(id: string): this {
    this.id = toReportId(id);
    return this;
  }

  forWorksite(worksiteId: WorksiteId): this {
    this.worksiteId = worksiteId;
    return this;
  }

  by(authorId: UserId): this {
    this.authorId = authorId;
    return this;
  }

  on(workDate: string): this {
    this.workDate = toWorkDate(workDate);
    return this;
  }

  withItems(...items: ItemInput[]): this {
    this.items = items.map((item) =>
      ReportItem.restore({
        taskId: toTaskId(item.taskId),
        reportedProgress: toProgress(item.reportedProgress),
        note: item.note ?? null,
      }),
    );
    return this;
  }

  withNoItems(): this {
    this.items = [];
    return this;
  }

  withNote(note: string | null): this {
    this.note = note;
    return this;
  }

  withVersion(version: number): this {
    this.version = version;
    return this;
  }

  /** The supervisor recorded on rejection and approval transitions. */
  reviewedBy(supervisorId: UserId): this {
    this.supervisorId = supervisorId;
    return this;
  }

  submitted(): this {
    this.status = ReportStatus.SUBMITTED;
    return this;
  }

  rejected(): this {
    this.status = ReportStatus.REJECTED;
    return this;
  }

  approved(): this {
    this.status = ReportStatus.APPROVED;
    return this;
  }

  build(): DailyReport {
    return DailyReport.restore({
      id: this.id,
      worksiteId: this.worksiteId,
      authorId: this.authorId,
      workDate: this.workDate,
      status: this.status,
      version: this.version,
      note: this.note,
      items: this.items,
      transitions: this.transitionsFor(this.status),
    });
  }

  /** The history that leads to the status, so a built report is consistent with BR-11. */
  private transitionsFor(status: ReportStatus): ReportTransition[] {
    const submit: ReportTransition = {
      from: ReportStatus.DRAFT,
      to: ReportStatus.SUBMITTED,
      actorId: this.authorId,
      occurredAt: SUBMITTED_AT,
      reason: null,
    };
    switch (status) {
      case ReportStatus.DRAFT:
        return [];
      case ReportStatus.SUBMITTED:
        return [submit];
      case ReportStatus.REJECTED:
        return [
          submit,
          {
            from: ReportStatus.SUBMITTED,
            to: ReportStatus.REJECTED,
            actorId: this.supervisorId,
            occurredAt: REJECTED_AT,
            reason: "conduit laid, no wiring pulled yet",
          },
        ];
      case ReportStatus.APPROVED:
        return [
          submit,
          {
            from: ReportStatus.SUBMITTED,
            to: ReportStatus.APPROVED,
            actorId: this.supervisorId,
            occurredAt: APPROVED_AT,
            reason: null,
          },
        ];
      default:
        return [];
    }
  }
}

export function aReport(): DailyReportBuilder {
  return new DailyReportBuilder();
}
