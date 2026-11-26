// IDs that both modules use. They live in shared/domain because reporting/domain may import only its own domain
// and shared/domain (ARC-01), and still needs to refer to worksites and tasks (research R1, feature 002).

declare const worksiteIdBrand: unique symbol;

/** ID of a worksite (TS-08). */
export type WorksiteId = string & { readonly [worksiteIdBrand]: true };

export function toWorksiteId(value: string): WorksiteId {
  return value as WorksiteId;
}

declare const taskIdBrand: unique symbol;

/** ID of a task (TS-08). */
export type TaskId = string & { readonly [taskIdBrand]: true };

export function toTaskId(value: string): TaskId {
  return value as TaskId;
}
