import type { Actor } from "../../../shared/domain/actor";
import { NotFoundError } from "../../../shared/domain/errors";
import type { WorksiteId } from "../../../shared/domain/ids";
import type { WorksiteStatus } from "../domain/worksite";
import type { WorksiteRepository } from "../domain/worksite.repository";

export interface GetWorksiteInput {
  readonly worksiteId: WorksiteId;
  readonly actor: Actor;
}

/** A task as the caller sees it. People are identified by user ID only (FR-009). */
export interface TaskView {
  readonly id: string;
  readonly name: string;
  readonly assigneeId: string;
  readonly approvedProgress: number;
}

/** A worksite and the tasks the caller may see (FR-008, FR-008a). */
export interface WorksiteView {
  readonly id: string;
  readonly name: string;
  readonly status: WorksiteStatus;
  readonly supervisorId: string;
  readonly tasks: readonly TaskView[];
}

/** View a worksite and its tasks. Reads only (FR-012). */
export class GetWorksite {
  private readonly worksites: WorksiteRepository;

  constructor(worksites: WorksiteRepository) {
    this.worksites = worksites;
  }

  async execute(input: GetWorksiteInput): Promise<WorksiteView> {
    const worksite = await this.worksites.findById(input.worksiteId);
    if (worksite === undefined) {
      throw new NotFoundError("WORKSITE_NOT_FOUND", `There is no worksite with ID ${input.worksiteId}.`, {
        worksiteId: input.worksiteId,
      });
    }

    return {
      id: worksite.id,
      name: worksite.name,
      status: worksite.status,
      supervisorId: worksite.supervisorId,
      tasks: worksite.tasksVisibleTo(input.actor).map(
        (task): TaskView => ({
          id: task.id,
          name: task.name,
          assigneeId: task.assigneeId,
          approvedProgress: task.approvedProgress,
        }),
      ),
    };
  }
}
