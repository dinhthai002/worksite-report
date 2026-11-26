import { randomUUID } from "node:crypto";
import { Task, toTaskId } from "@src/modules/worksite/domain/task";
import { toWorksiteId, Worksite, WorksiteStatus } from "@src/modules/worksite/domain/worksite";
import { toUserId, type UserId } from "@src/shared/domain/actor";

/** Builds a Task with valid defaults (TST-10). */
export class TaskBuilder {
  private id = toTaskId(randomUUID());
  private name = "Build ground-floor walls";
  private assigneeId: UserId = toUserId(randomUUID());
  private approvedProgress = 0;

  withId(id: string): this {
    this.id = toTaskId(id);
    return this;
  }

  named(name: string): this {
    this.name = name;
    return this;
  }

  assignedTo(userId: UserId): this {
    this.assigneeId = userId;
    return this;
  }

  withApprovedProgress(approvedProgress: number): this {
    this.approvedProgress = approvedProgress;
    return this;
  }

  build(): Task {
    return Task.restore({
      id: this.id,
      name: this.name,
      assigneeId: this.assigneeId,
      approvedProgress: this.approvedProgress,
    });
  }
}

/** Builds a Worksite with valid defaults: ACTIVE, no tasks (TST-10). */
export class WorksiteBuilder {
  private id = toWorksiteId(randomUUID());
  private name = "Three-storey townhouse";
  private supervisorId: UserId = toUserId(randomUUID());
  private status: WorksiteStatus = WorksiteStatus.ACTIVE;
  private tasks: Task[] = [];

  withId(id: string): this {
    this.id = toWorksiteId(id);
    return this;
  }

  supervisedBy(userId: UserId): this {
    this.supervisorId = userId;
    return this;
  }

  closed(): this {
    this.status = WorksiteStatus.CLOSED;
    return this;
  }

  withTasks(...tasks: Task[]): this {
    this.tasks = tasks;
    return this;
  }

  build(): Worksite {
    return Worksite.restore({
      id: this.id,
      name: this.name,
      supervisorId: this.supervisorId,
      status: this.status,
      tasks: this.tasks,
    });
  }
}

export function aTask(): TaskBuilder {
  return new TaskBuilder();
}

export function aWorksite(): WorksiteBuilder {
  return new WorksiteBuilder();
}
