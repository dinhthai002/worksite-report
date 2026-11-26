import type { Worksite, WorksiteId } from "./worksite";

/** Loads worksites with their tasks. No save until a feature writes worksites (feature 005). */
export interface WorksiteRepository {
  /** The worksite with its tasks ordered last changed first (FR-010), or undefined when there is none. */
  findById(id: WorksiteId): Promise<Worksite | undefined>;
}
