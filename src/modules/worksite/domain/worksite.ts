import { type Actor, Role, type UserId } from "../../../shared/domain/actor";
import { assertNever } from "../../../shared/domain/assert-never";
import type { WorksiteId } from "../../../shared/domain/ids";
import type { Task } from "./task";

/** Status of a worksite (glossary). Reports can be created only for an ACTIVE worksite (BR-3, feature 002). */
export const WorksiteStatus = {
  ACTIVE: "ACTIVE",
  CLOSED: "CLOSED",
} as const;

export type WorksiteStatus = (typeof WorksiteStatus)[keyof typeof WorksiteStatus];

export interface WorksiteProps {
  readonly id: WorksiteId;
  readonly name: string;
  readonly supervisorId: UserId;
  readonly status: WorksiteStatus;
  /** In the order they were loaded: last changed first (FR-010). */
  readonly tasks: readonly Task[];
}

/** A construction site under way, with one site supervisor and many tasks (glossary). Aggregate root. */
export class Worksite {
  readonly id: WorksiteId;
  readonly name: string;
  readonly supervisorId: UserId;
  readonly status: WorksiteStatus;
  readonly tasks: readonly Task[];

  private constructor(props: WorksiteProps) {
    this.id = props.id;
    this.name = props.name;
    this.supervisorId = props.supervisorId;
    this.status = props.status;
    this.tasks = [...props.tasks];
  }

  /** Rebuilds a worksite from stored data. */
  static restore(props: WorksiteProps): Worksite {
    return new Worksite(props);
  }

  /**
   * FR-008a: a site supervisor sees every task of the worksite; a foreman sees only the tasks assigned to them.
   * The order is kept.
   */
  tasksVisibleTo(actor: Actor): readonly Task[] {
    switch (actor.role) {
      case Role.SITE_SUPERVISOR:
        return this.tasks;
      case Role.FOREMAN:
        return this.tasks.filter((task) => task.isAssignedTo(actor.id));
      default:
        return assertNever(actor.role);
    }
  }
}
