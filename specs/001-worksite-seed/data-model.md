# Data model: Worksite seed and identity check

Phase 1 of [plan.md](./plan.md). Decisions are explained in [research.md](./research.md).

## 1. Domain model

### `shared/domain`

| Name | Kind | Definition |
| --- | --- | --- |
| `Role` | Const object and type, in `actor.ts` | `Role.FOREMAN`, `Role.SITE_SUPERVISOR` (glossary). `ROLES` lists both. `isRole(value)` narrows a string (R9) |
| `UserId` | Branded string | Existing, unchanged |
| `Actor` | Value | `{ id: UserId, role: Role }`. Existing, unchanged |
| `UserRepository` | Port | `findRoleById(id: UserId): Promise<Role \| undefined>`. `undefined` means no such user (R1) |

### `worksite/domain`

| File | Name | Kind | Definition |
| --- | --- | --- | --- |
| `task.ts` | `TaskId` | Branded string | With `toTaskId` (TS-08) |
| `task.ts` | `Task` | Entity | `id: TaskId`, `name: string`, `assigneeId: UserId`, `approvedProgress: number` (0 to 100, guarded by the database; R10). Does not import `Worksite` |
| `task.ts` | `Task.isAssignedTo(userId)` | Method | `true` when `assigneeId` equals `userId`. Used by `tasksVisibleTo`, and by BR-4 in feature 002 |
| `worksite.ts` | `WorksiteId` | Branded string | With `toWorksiteId` (TS-08) |
| `worksite.ts` | `WorksiteStatus` | Const object and type | `ACTIVE`, `CLOSED` (glossary). No transition in this feature |
| `worksite.ts` | `Worksite` | Aggregate root | `id: WorksiteId`, `name: string`, `supervisorId: UserId`, `status: WorksiteStatus`, `tasks: readonly Task[]` in the order loaded (R4) |
| `worksite.ts` | `Worksite.restore(props)` | Factory | Rebuilds a worksite from stored data. Takes the `id` (implementation plan, section 3) |
| `worksite.ts` | `Worksite.tasksVisibleTo(actor)` | Method | `SITE_SUPERVISOR`: every task. `FOREMAN`: the tasks where `task.isAssignedTo(actor.id)`, possibly none. Keeps the order (FR-008a; R5) |
| `worksite.repository.ts` | `WorksiteRepository` | Port | `findById(id: WorksiteId): Promise<Worksite \| undefined>` (R11) |

No business rule (BR-x) is implemented in this feature. `tasksVisibleTo` cites FR-008a.

### `worksite/application`

`GetWorksite.execute({ worksiteId, actor }): Promise<WorksiteView>`

- Loads the worksite. When it is missing, throws
  `NotFoundError("WORKSITE_NOT_FOUND", "There is no worksite with ID <id>.", { worksiteId })`
  (FR-011).
- Returns a `WorksiteView`: `{ id, name, status, supervisorId, tasks: TaskView[] }`, with
  `TaskView = { id, name, assigneeId, approvedProgress }`. The tasks come from
  `worksite.tasksVisibleTo(actor)`. No names or roles (FR-009).
- Writes nothing (FR-012).

## 2. Tables

All names are `snake_case` (NAM-06). Every table has the two timestamp columns and the trigger in
section 2.4 (FR-015a; R3). IDs are `uuid` with no default: the seed and, from feature 005, the use
cases supply them (implementation plan, section 3).

### 2.1 `users`

| Column | Type | Null | Default | Constraint |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | | primary key |
| `name` | `text` | no | | |
| `role` | `user_role` | no | | enum `FOREMAN`, `SITE_SUPERVISOR` (FR-006) |
| `created_at` | `timestamptz(6)` | no | `now()` | |
| `updated_at` | `timestamptz(6)` | no | `now()` | set by trigger on update |

### 2.2 `worksites`

| Column | Type | Null | Default | Constraint |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | | primary key |
| `name` | `text` | no | | |
| `supervisor_id` | `uuid` | no | | foreign key `users(id)`, `ON DELETE RESTRICT`; index (FR-013) |
| `status` | `worksite_status` | no | `'ACTIVE'` | enum `ACTIVE`, `CLOSED` (FR-013) |
| `created_at` | `timestamptz(6)` | no | `now()` | |
| `updated_at` | `timestamptz(6)` | no | `now()` | set by trigger on update |

### 2.3 `tasks`

| Column | Type | Null | Default | Constraint |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | | primary key |
| `worksite_id` | `uuid` | no | | foreign key `worksites(id)`, `ON DELETE RESTRICT`; index (FR-014) |
| `name` | `text` | no | | |
| `assignee_id` | `uuid` | no | | foreign key `users(id)`, `ON DELETE RESTRICT`; index (FR-014) |
| `approved_progress` | `integer` | no | `0` | `CHECK (approved_progress BETWEEN 0 AND 100)`, named `tasks_approved_progress_range` (FR-015) |
| `created_at` | `timestamptz(6)` | no | `now()` | |
| `updated_at` | `timestamptz(6)` | no | `now()` | set by trigger on update |

The database does not check that a supervisor is a `SITE_SUPERVISOR` or that an assignee is a
`FOREMAN`. The seed's data satisfies both. BR-13 enforces it when assignment arrives (feature 005).

### 2.4 Hand-written SQL in the migration

`schema.prisma` cannot express these, so they are added to the generated migration before it is
committed (architecture.md, section 5.1):

- the `CHECK` constraint `tasks_approved_progress_range`;
- the function `set_updated_at()` (`BEFORE UPDATE`, `NEW.updated_at = now()`) and one trigger per
  table: `users_set_updated_at`, `worksites_set_updated_at`, `tasks_set_updated_at`.

Migration name: `create_users_worksites_tasks`.

### 2.5 `schema.prisma` mapping

| Prisma | Database |
| --- | --- |
| `enum UserRole` | `user_role` |
| `enum WorksiteStatus` | `worksite_status` |
| `model User` (`id`, `name`, `role`, `createdAt`, `updatedAt`) | `users` |
| `model Worksite` (`id`, `name`, `supervisorId`, `status`, `createdAt`, `updatedAt`) | `worksites` |
| `model Task` (`id`, `worksiteId`, `name`, `assigneeId`, `approvedProgress`, `createdAt`, `updatedAt`) | `tasks` |

Fields are `camelCase` with `@map` to the `snake_case` column. Timestamps are
`DateTime @default(now()) @db.Timestamptz(6)`, with no `@updatedAt` (R3). Prisma types stay in
`infrastructure`: mappers import them as `WorksiteRow` and `TaskRow` (ARC-08).

## 3. Mapping

`worksite.mapper.ts` turns a `worksites` row with its `tasks` rows into a `Worksite`:

| Row | Domain |
| --- | --- |
| `worksites.id`, `name`, `supervisor_id`, `status` | `id`, `name`, `supervisorId`, `status` |
| `tasks.id`, `name`, `assignee_id`, `approved_progress` | `Task.id`, `name`, `assigneeId`, `approvedProgress` |
| `created_at`, `updated_at` | not mapped; used only by the query's `ORDER BY` (R4) |

`PrismaWorksiteRepository.findById` loads the worksite with
`tasks: { orderBy: [{ updatedAt: "desc" }, { createdAt: "asc" }, { id: "asc" }] }` (FR-010).

`PrismaUserRepository.findRoleById` selects `role` by `id` and maps the Prisma enum to `Role`.

## 4. Example data

Loaded by `prisma/seed.ts` (FR-016 to FR-018b; R6, R7). Values from the PRD example.

| Table | ID | Values |
| --- | --- | --- |
| `users` | `…000000000001` | Linda, `SITE_SUPERVISOR` |
| `users` | `…000000000002` | Mark, `FOREMAN` |
| `users` | `…000000000003` | Henry, `FOREMAN` |
| `worksites` | `…000000000101` | Three-storey townhouse, supervisor Linda, `ACTIVE` |
| `tasks` | `…000000000201` | Pour foundation, assignee Mark, 100 |
| `tasks` | `…000000000202` | Build ground-floor walls, assignee Mark, 40 |
| `tasks` | `…000000000203` | Install electrical, assignee Henry, 0 |

`…` is `00000000-0000-4000-8000-`.

| Mode | Started by | Existing example row | Missing example row | Other rows |
| --- | --- | --- | --- | --- |
| `fill` | compose `migrate` service, on every `docker compose up` | unchanged, including `updated_at` | inserted | untouched |
| `reset` | `npx prisma db seed`, `npx prisma migrate reset` | set to the values above; `updated_at` advances, `created_at` unchanged | inserted | untouched |
