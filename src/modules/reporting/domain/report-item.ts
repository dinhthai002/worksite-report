import { RuleViolationError } from "../../../shared/domain/errors";
import type { TaskId } from "../../../shared/domain/ids";
import { isProgress, MAX_PROGRESS, MIN_PROGRESS, type Progress } from "../../../shared/domain/progress";

export interface ReportItemProps {
  readonly taskId: TaskId;
  readonly reportedProgress: Progress;
  readonly note: string | null;
}

/** The progress of one task within a daily report (glossary). Its identity is its task, within its report. */
export class ReportItem {
  readonly taskId: TaskId;
  /** Cumulative, as of the end of the work date (glossary). */
  readonly reportedProgress: Progress;
  readonly note: string | null;

  private constructor(props: ReportItemProps) {
    this.taskId = props.taskId;
    this.reportedProgress = props.reportedProgress;
    this.note = props.note;
  }

  /** Rebuilds an item from stored data. */
  static restore(props: ReportItemProps): ReportItem {
    return new ReportItem(props);
  }

  /** A new item from a foreman's input. */
  static create(taskId: TaskId, reportedProgress: number, note: string | null): ReportItem {
    // BR-5 (range): the comparison with approved progress happens on submit, in DailyReport.
    if (!isProgress(reportedProgress)) {
      throw new RuleViolationError(
        "PROGRESS_OUT_OF_RANGE",
        `The reported progress for task ${taskId} must be a whole number from ${MIN_PROGRESS} to ${MAX_PROGRESS}.`,
        { taskId, reportedProgress, min: MIN_PROGRESS, max: MAX_PROGRESS },
      );
    }
    return new ReportItem({ taskId, reportedProgress, note });
  }
}
