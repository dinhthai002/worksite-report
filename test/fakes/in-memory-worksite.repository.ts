import type { Worksite, WorksiteId } from "@src/modules/worksite/domain/worksite";
import type { WorksiteRepository } from "@src/modules/worksite/domain/worksite.repository";

/** In-memory WorksiteRepository for unit tests (TST-06). Keeps each worksite's task order as given. */
export class InMemoryWorksiteRepository implements WorksiteRepository {
  private readonly worksites: readonly Worksite[];

  constructor(worksites: readonly Worksite[] = []) {
    this.worksites = worksites;
  }

  findById(id: WorksiteId): Promise<Worksite | undefined> {
    return Promise.resolve(this.worksites.find((worksite) => worksite.id === id));
  }
}
