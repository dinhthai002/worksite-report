import type { Task as TaskRow, Worksite as WorksiteRow, WorksiteStatus as WorksiteStatusRow } from "@prisma/client";
import { toUserId } from "../../../shared/domain/actor";
import { assertNever } from "../../../shared/domain/assert-never";
import { toTaskId, toWorksiteId } from "../../../shared/domain/ids";
import { toProgress } from "../../../shared/domain/progress";
import { Task } from "../domain/task";
import { Worksite, WorksiteStatus } from "../domain/worksite";

export type WorksiteWithTasksRow = WorksiteRow & { readonly tasks: readonly TaskRow[] };

/** Rows to domain objects (ARC-08). Timestamps are not mapped; they only order the query (FR-010). */
export function toWorksite(row: WorksiteWithTasksRow): Worksite {
  return Worksite.restore({
    id: toWorksiteId(row.id),
    name: row.name,
    supervisorId: toUserId(row.supervisorId),
    status: toWorksiteStatus(row.status),
    tasks: row.tasks.map(toTask),
  });
}

function toTask(row: TaskRow): Task {
  return Task.restore({
    id: toTaskId(row.id),
    name: row.name,
    assigneeId: toUserId(row.assigneeId),
    // The tasks_approved_progress_range CHECK guarantees the range.
    approvedProgress: toProgress(row.approvedProgress),
  });
}

function toWorksiteStatus(status: WorksiteStatusRow): WorksiteStatus {
  switch (status) {
    case "ACTIVE":
      return WorksiteStatus.ACTIVE;
    case "CLOSED":
      return WorksiteStatus.CLOSED;
    default:
      return assertNever(status);
  }
}
