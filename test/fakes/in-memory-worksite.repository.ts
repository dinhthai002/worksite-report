import type { Worksite } from "@src/modules/worksite/domain/worksite";
import type { WorksiteRepository } from "@src/modules/worksite/domain/worksite.repository";
import type { WorksiteId } from "@src/shared/domain/ids";

/** In-memory WorksiteRepository for unit tests (TST-06). Keeps each worksite's task order as given. */
export class InMemoryWorksiteRepository implements WorksiteRepository {
  private readonly worksites = new Map<WorksiteId, Worksite>();

  constructor(worksites: readonly Worksite[] = []) {
    for (const worksite of worksites) {
      this.worksites.set(worksite.id, worksite);
    }
  }

  findById(id: WorksiteId): Promise<Worksite | undefined> {
    return Promise.resolve(this.worksites.get(id));
  }

  /**
   * Test only: stores a new version of a worksite. The fake report repository uses it to record approved progress on
   * approval, which the real repository writes in the same transaction as the report (ADR 0004).
   */
  replace(worksite: Worksite): void {
    this.worksites.set(worksite.id, worksite);
  }
}
