import type { UserId } from "../../../shared/domain/actor";
import type { TaskId } from "../../../shared/domain/ids";
import type { Progress } from "../../../shared/domain/progress";

export interface TaskProps {
  readonly id: TaskId;
  readonly name: string;
  readonly assigneeId: UserId;
  readonly approvedProgress: Progress;
}

/** A unit of construction work within a worksite (glossary). Reached through its Worksite. */
export class Task {
  readonly id: TaskId;
  readonly name: string;
  readonly assigneeId: UserId;
  readonly approvedProgress: Progress;

  private constructor(props: TaskProps) {
    this.id = props.id;
    this.name = props.name;
    this.assigneeId = props.assigneeId;
    this.approvedProgress = props.approvedProgress;
  }

  /** Rebuilds a task from stored data. */
  static restore(props: TaskProps): Task {
    return new Task(props);
  }

  /** Whether this task is assigned to the given user. */
  isAssignedTo(userId: UserId): boolean {
    return this.assigneeId === userId;
  }
}
