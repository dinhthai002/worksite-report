import type { UserId } from "../../../shared/domain/actor";

declare const taskIdBrand: unique symbol;

/** ID of a task (TS-08). */
export type TaskId = string & { readonly [taskIdBrand]: true };

export function toTaskId(value: string): TaskId {
  return value as TaskId;
}

export interface TaskProps {
  readonly id: TaskId;
  readonly name: string;
  readonly assigneeId: UserId;
  /** 0 to 100. The database guards the range until feature 002 introduces the Progress value object. */
  readonly approvedProgress: number;
}

/** A unit of construction work within a worksite (glossary). Reached through its Worksite. */
export class Task {
  readonly id: TaskId;
  readonly name: string;
  readonly assigneeId: UserId;
  readonly approvedProgress: number;

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
