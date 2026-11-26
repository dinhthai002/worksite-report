---
description: "Task list for 001-worksite-seed"
---

# Tasks: Worksite seed and identity check

**Input**: Design documents from `specs/001-worksite-seed/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: required. Constitution principle VII and testing.md §1.1 require unit tests for domain, use
cases and middleware, integration tests for repositories, migrations and the seed, and API tests for
endpoints and middleware. Each test task maps to a row of the plan's test plan.

**Organization**: grouped by user story. Within a story, the order is domain and its unit tests, then
the use case and its unit tests, then the repository and its integration tests, then the route and
its API tests (constitution, Development Workflow).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story from spec.md (US1, US2, US3)

## Conventions for every task

- Read `AGENTS.md` and the files the task names before editing. Use glossary terms exactly.
- Production code under `src/` uses relative imports; tests import it as `@src/...` (TST-13).
- After each task that changes code, `npm run check` passes. Report the actual output.
- Integration and API tests need Docker. Run them with `npm run test:int` and `npm run test:api`.
- Do not edit `tsconfig.json`, `biome.json`, `.dependency-cruiser.cjs` or the CI workflow, and do
  not add ignore comments.

---

## Phase 1: Setup (shared building blocks)

**Purpose**: small shared pieces every later phase uses.

- [X] T001 [P] Create `src/shared/domain/assert-never.ts` exporting `assertNever(value: never): never`, which throws an `Error` naming the unexpected value (TS-06). Add `test/unit/shared/domain/assert-never.test.ts`: `assertNever("ADMIN" as never)` throws an error whose message contains `ADMIN` (a single `as never` cast is allowed; TS-03 forbids only `as unknown as T`).
- [X] T002 [P] In `src/shared/domain/actor.ts`, replace the `ROLES` array with the const object `export const Role = { FOREMAN: "FOREMAN", SITE_SUPERVISOR: "SITE_SUPERVISOR" } as const;` and the type `export type Role = (typeof Role)[keyof typeof Role];`. Keep `export const ROLES = [Role.FOREMAN, Role.SITE_SUPERVISOR] as const` and `isRole` so `actor.middleware.ts` keeps compiling (research R9). In `test/unit/shared/domain/actor.test.ts` add `it("Role holds exactly FOREMAN and SITE_SUPERVISOR")` asserting `Object.values(Role)` equals `["FOREMAN", "SITE_SUPERVISOR"]` (FR-006).

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: tables, constraints and test helpers that all three stories need.

**⚠️ CRITICAL**: no user story work starts until this phase is complete.

- [X] T003 Edit `prisma/schema.prisma` per data-model.md §2 and §2.5. Add `enum UserRole { FOREMAN SITE_SUPERVISOR @@map("user_role") }` and `enum WorksiteStatus { ACTIVE CLOSED @@map("worksite_status") }`. Add models `User` (`users`), `Worksite` (`worksites`), `Task` (`tasks`) with `camelCase` fields mapped by `@map` to `snake_case` columns (NAM-06). Constraints, verbatim from data-model.md: every `id` is `String @id @db.Uuid` with no default; `supervisor_id` "foreign key `users(id)`, `ON DELETE RESTRICT`; index"; `status` default `'ACTIVE'`; `worksite_id` "foreign key `worksites(id)`, `ON DELETE RESTRICT`; index"; `assignee_id` "foreign key `users(id)`, `ON DELETE RESTRICT`; index"; `approved_progress` `integer`, not null, default `0`; `created_at` and `updated_at` `DateTime @default(now()) @db.Timestamptz(6)`, **no `@updatedAt`** (research R3). Remove the placeholder comment at the top of the file.
- [X] T004 Create the migration with `docker compose up -d db` then `npx prisma migrate dev --create-only --name create_users_worksites_tasks`. Append to the generated `prisma/migrations/<timestamp>_create_users_worksites_tasks/migration.sql` (data-model.md §2.4): `ALTER TABLE "tasks" ADD CONSTRAINT "tasks_approved_progress_range" CHECK ("approved_progress" BETWEEN 0 AND 100);`; a function `set_updated_at()` returning `trigger` that sets `NEW.updated_at = now()` and returns `NEW`; triggers `users_set_updated_at`, `worksites_set_updated_at`, `tasks_set_updated_at`, each `BEFORE UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION set_updated_at()`. Then apply it with `npx prisma migrate dev`. Do not edit it after it is committed (DB-05).
- [X] T005 Create `test/support/database.ts` exporting `truncateAll(client: DatabaseClient): Promise<void>`, one tagged `$queryRaw` running a `DO` block that truncates every table in `current_schema()` except `_prisma_migrations`, with `CASCADE`, and no interpolated values (TST-08, research R12). If the `DO` block fails through `$queryRaw`, stop and report it. Do not switch to `$executeRaw` (DB-06). In the same file add row helpers with valid defaults (TST-10): `insertUser(client, overrides?)`, `insertWorksite(client, overrides?)`, `insertTask(client, overrides?)`, each generating a UUID with `crypto.randomUUID()` unless one is given, and accepting optional `createdAt` and `updatedAt` so tests can control order.
- [X] T006 Create `test/integration/schema.int.test.ts` (each test starts with `truncateAll`): `approved_progress` of -1 and 101 is rejected with the constraint `tasks_approved_progress_range`, and 0 and 100 are accepted (FR-015, SC-005); a task inserted without `approved_progress` has 0; a worksite inserted without `status` is `ACTIVE`; an invalid role or status inserted with a tagged `$queryRaw` (DB-06) is rejected; for each of `users`, `worksites`, `tasks`, insert a row with `createdAt` and `updatedAt` of `2000-01-01T00:00:00Z`, update it, and assert `updated_at` is later than 2000-01-01 and `created_at` is unchanged (FR-015a).
- [X] T007 In `package.json`, remove `--passWithNoTests` from the `test:int` script. In `docs/engineering/testing.md` §6, delete the sentence "Until the first integration test exists, `npm run test:int` runs with `--passWithNoTests`. Remove the flag when that test is added." Run `npm run test:int` and confirm it runs T006.

**Checkpoint**: `npm run check` and `npm run test:int` pass. Suggested commit: `feat(db): add users, worksites and tasks tables`.

---

## Phase 3: User Story 1 - View a worksite and its tasks (Priority: P1) 🎯 MVP

**Goal**: `GET /worksites/:worksiteId` returns the worksite and the tasks the caller may see, in last-changed order ([contracts/get-worksite.md](./contracts/get-worksite.md)).

**Independent Test**: insert a worksite with tasks for two Foremen, request it as the Site Supervisor and as each Foreman, and compare with the stored rows. An unknown ID returns `404`.

### Domain

- [X] T008 [P] [US1] Create `src/modules/worksite/domain/task.ts`: branded `TaskId` and `toTaskId` (TS-08); class `Task` with readonly `id: TaskId`, `name: string`, `assigneeId: UserId`, `approvedProgress: number`, built through a static `restore(props)`; method `isAssignedTo(userId: UserId): boolean`. It does not import `worksite.ts` (data-model.md §1).
- [X] T009 [US1] Create `src/modules/worksite/domain/worksite.ts`: branded `WorksiteId` and `toWorksiteId`; const object and type `WorksiteStatus` (`ACTIVE`, `CLOSED`); class `Worksite` with readonly `id`, `name`, `supervisorId: UserId`, `status`, `tasks: readonly Task[]`, built through `static restore(props)`; method `tasksVisibleTo(actor: Actor): readonly Task[]` with a `switch (actor.role)`: `SITE_SUPERVISOR` returns every task, `FOREMAN` returns `tasks.filter((task) => task.isAssignedTo(actor.id))`, default `assertNever` (TS-06). Comment `// FR-008a` on the method. Keep the given task order (research R4, R5).
- [X] T010 [P] [US1] Create `src/modules/worksite/domain/worksite.repository.ts`: `export interface WorksiteRepository { findById(id: WorksiteId): Promise<Worksite | undefined>; }` (research R11).
- [X] T011 [US1] Create `test/support/worksite.builder.ts` with builders that have valid defaults (TST-10): `aTask()` with `.withId()`, `.assignedTo(userId)`, `.withApprovedProgress(n)`, `.build()`; `aWorksite()` with `.withId()`, `.supervisedBy(userId)`, `.closed()`, `.withTasks(...tasks)`, `.build()`.
- [X] T012 [P] [US1] Create `test/unit/modules/worksite/domain/task.test.ts`: `isAssignedTo` is true for the assignee and false for another user.
- [X] T013 [P] [US1] Create `test/unit/modules/worksite/domain/worksite.test.ts`: a Site Supervisor sees every task in the given order; a Foreman sees only the tasks assigned to them, in the given order; a Foreman with no tasks sees `[]`; a worksite with no tasks returns `[]` for both roles.

### Application

- [X] T014 [P] [US1] Create `test/fakes/in-memory-worksite.repository.ts`: `InMemoryWorksiteRepository implements WorksiteRepository`, constructed with an array of `Worksite`, returning a match by `id` or `undefined` (TST-06).
- [X] T015 [US1] Create `src/modules/worksite/application/get-worksite.ts`: class `GetWorksite` with constructor `(worksites: WorksiteRepository)` and `execute(input: { worksiteId: WorksiteId; actor: Actor }): Promise<WorksiteView>`. When the worksite is missing, throw `new NotFoundError("WORKSITE_NOT_FOUND", \`There is no worksite with ID ${worksiteId}.\`, { worksiteId })` (FR-011). Otherwise return `{ id, name, status, supervisorId, tasks }` where `tasks` maps `worksite.tasksVisibleTo(actor)` to `TaskView = { id, name, assigneeId, approvedProgress }`. Export the `WorksiteView` and `TaskView` types. No names or roles (FR-009).
- [X] T016 [US1] Create `test/unit/modules/worksite/application/get-worksite.test.ts` with the fake and builders: returns the view with identifiers only, for a Site Supervisor (all tasks) and a Foreman (own tasks); throws `NotFoundError` with code `WORKSITE_NOT_FOUND`, a message containing the ID, and `details.worksiteId`.

### Infrastructure

- [X] T017 [US1] Create `src/modules/worksite/infrastructure/worksite.mapper.ts`: `toWorksite(row: WorksiteRow & { tasks: TaskRow[] }): Worksite`, importing Prisma's `Worksite` and `Task` types as `WorksiteRow` and `TaskRow` (ARC-08). Map the Prisma `WorksiteStatus` enum with a `switch` ending in `assertNever`. Timestamps are not mapped (data-model.md §3).
- [X] T018 [US1] Create `src/modules/worksite/infrastructure/prisma-worksite.repository.ts`: `PrismaWorksiteRepository implements WorksiteRepository`, constructor `(client: DatabaseClient)`. `findById` runs `client.worksite.findUnique({ where: { id }, include: { tasks: { orderBy: [{ updatedAt: "desc" }, { createdAt: "asc" }, { id: "asc" }] } } })` and maps with `toWorksite`, or returns `undefined` (FR-010).
- [X] T019 [US1] Create `test/integration/worksite.repository.int.test.ts` (each test starts with `truncateAll`): rows inserted with the helpers load back equal to the expected `Worksite` built with the builders (round trip); an unknown ID returns `undefined`; tasks are ordered by `updated_at` descending, then `created_at` ascending, then `id` ascending, using explicit timestamps for three cases (distinct `updated_at`; equal `updated_at`, distinct `created_at`; both equal, ordered by `id`) (FR-010, US1-7).

### Interface

- [X] T020 [P] [US1] Create `src/shared/infrastructure/http/validate-input.middleware.ts` exporting `withValidInput(schemas, handler)` per research R15. `schemas` has optional `params`, `query`, `body` Zod schemas. Parse `{ params: req.params, query: req.query, body: req.body }` with one `z.object`, defaults `params: z.strictObject({})`, `query: z.strictObject({})`, `body: z.union([z.undefined(), z.strictObject({})])`. On success call `handler(input, res, req)` with typed input; on failure pass the `ZodError` to `next`. Do not assign to `req.query` (Express 5 getter).
- [X] T021 [P] [US1] Create `test/unit/shared/infrastructure/http/validate-input.middleware.test.ts`: passes typed params, query and body to the handler; a bad param fails with an issue path `params.<name>`; an unknown query key fails with an issue path `query` whose message names the key; a body where none is declared fails with path `body`; an absent body and `{}` are accepted when none is declared.
- [X] T022 [US1] In `src/shared/infrastructure/http/actor.middleware.ts`, add `currentActor(res: Response): Actor`, returning `res.locals.actor` or throwing a plain `Error("currentActor called before actorMiddleware")` (a programming error, so `500`). Add tests to `test/unit/shared/infrastructure/http/actor.middleware.test.ts` for both cases.
- [X] T023 [P] [US1] Create `src/modules/worksite/interface/worksite.schemas.ts`: `export const getWorksiteParams = z.object({ worksiteId: z.uuid() });`.
- [X] T024 [US1] Create `src/modules/worksite/interface/worksite.routes.ts`: `worksiteRoutes(getWorksite: GetWorksite): Router` with `GET /worksites/:worksiteId` through `withValidInput({ params: getWorksiteParams }, …)`, calling `getWorksite.execute({ worksiteId: toWorksiteId(params.worksiteId), actor: currentActor(res) })` and responding `200` with the view (ARC-07).
- [X] T025 [US1] Replace `src/modules/worksite/index.ts` with exports of `worksiteRoutes`, `GetWorksite`, `PrismaWorksiteRepository`, and the types `Worksite`, `Task`, `WorksiteId`, `TaskId`, `WorksiteStatus`, `WorksiteRepository`, `WorksiteView`, `TaskView` (ARC-03; research R14).
- [X] T026 [US1] In `src/app.ts`, add `getWorksite: GetWorksite` to `AppDependencies` and mount `worksiteRoutes(dependencies.getWorksite)` after `actorMiddleware()`, at the "Module routes are mounted here" comment. In `src/main.ts`, build `new GetWorksite(new PrismaWorksiteRepository(prisma))` and pass it (ARC-09). Create `test/support/test-app.ts` exporting `createTestApp(client: DatabaseClient): Express`, wired the same way as `main.ts` with a silent logger, and switch `test/api/health.api.test.ts` to it.
- [X] T027 [US1] Create `test/api/worksite.api.test.ts` (each test: `truncateAll`, then insert Linda, Mark, Henry, the townhouse and its three tasks with the helpers, using the IDs in data-model.md §4): Linda gets `200` with the worksite, `supervisorId`, and three tasks with approved progress 100, 40, 0 in that order; Mark gets tasks `…0201` and `…0202`; Henry gets `…0203`; a Foreman with no tasks there and a worksite with no tasks both return `tasks: []`; after updating Build ground-floor walls it is listed first (US1-7); an unknown ID returns `404 WORKSITE_NOT_FOUND` with `details.worksiteId`; `not-a-uuid` returns `400 VALIDATION_FAILED` with path `params.worksiteId`; `?foo=1` returns `400` with path `query`; a non-empty JSON body returns `400` with path `body`. Assert every error body has the shape `{ error: { code, message } }` (FR-020). Insert the three townhouse tasks with the same explicit `createdAt` and `updatedAt` (`2026-11-20T00:00:00Z`), as the seed does in its one transaction, so the `id` tie-break lists them in the PRD order.

**Checkpoint**: `npm run check`, `npm run test:int` and `npm run test:api` pass. US1 works on its own; at this point the actor check is still format-only. Suggested commit: `feat(worksite): view a worksite and its tasks`.

---

## Phase 4: User Story 2 - Unknown callers are rejected (Priority: P1)

**Goal**: every request except `/health` comes from a known user acting in their stored role; every failure returns the same `401` ([contracts/identity.md](./contracts/identity.md)).

**Independent Test**: request a worksite with no identity, a malformed identity, an unknown identity and a mismatched role; each returns the identical `401` and no worksite data. `/health` still answers.

### Domain

- [X] T028 [P] [US2] Create `src/shared/domain/user.repository.ts`: `export interface UserRepository { findRoleById(id: UserId): Promise<Role | undefined>; }` (research R1).
- [X] T029 [P] [US2] Create `test/fakes/in-memory-user.repository.ts`: `InMemoryUserRepository implements UserRepository`, constructed with `Actor[]` (id and stored role).

### Middleware

- [X] T030 [US2] Rework `src/shared/infrastructure/http/actor.middleware.ts` per research R2: export the literal union `UnauthenticatedReason = "HEADERS_MISSING" | "HEADERS_MALFORMED" | "UNKNOWN_USER" | "ROLE_MISMATCH"`; give `UnauthenticatedError` a readonly `reason` and the fixed message "Send X-Actor-Id as the UUID of a known user and X-Actor-Role as that user's role: FOREMAN or SITE_SUPERVISOR." for every reason; `readActor` throws `HEADERS_MISSING` when either header is absent and `HEADERS_MALFORMED` when either is invalid (including wrong case); `actorMiddleware(users: UserRepository)` becomes async: after `readActor`, `await users.findRoleById(actor.id)`, throw `UNKNOWN_USER` for `undefined` and `ROLE_MISMATCH` when it differs from the stated role, otherwise set `res.locals.actor` and call `next()`. Errors go to `next` (FR-001 to FR-005).
- [X] T031 [US2] Update `test/unit/shared/infrastructure/http/actor.middleware.test.ts` with the fake: a known user with the stored role passes and sets `res.locals.actor`; each failure produces `UnauthenticatedError` with the right `reason`; the unknown-user and role-mismatch errors have the same `code` and `message` (FR-005).
- [X] T032 [US2] In `src/shared/infrastructure/http/error-handler.ts`, log `UnauthenticatedError` with `logger.warn({ reason, method, path, requestId }, "request not authenticated")` before responding; the response body stays `{ error: { code, message } }` with no reason (FR-005a). Add tests to `test/unit/shared/infrastructure/http/error-handler.test.ts`, using a logger that records calls: the body has no `reason` or `details`, and `warn` received the reason.

### Infrastructure

- [X] T033 [US2] Create `src/shared/infrastructure/prisma-user.repository.ts`: `PrismaUserRepository implements UserRepository`, constructor `(client: DatabaseClient)`, `findRoleById` selecting `role` by `id` and mapping the Prisma `UserRole` enum to `Role` with a `switch` ending in `assertNever`.
- [X] T034 [US2] Create `test/integration/user.repository.int.test.ts`: returns the stored role for each role; returns `undefined` for an unknown ID.

### Wiring and API

- [X] T035 [US2] In `src/app.ts`, add `users: UserRepository` to `AppDependencies` and pass it to `actorMiddleware(dependencies.users)`. In `src/main.ts` pass `new PrismaUserRepository(prisma)`. Update `test/support/test-app.ts` the same way.
- [X] T036 [US2] Create `test/api/identity.api.test.ts` (users and the townhouse inserted per test): missing headers, a non-UUID ID, the role `foreman` in lower case, an unknown UUID, Mark with `SITE_SUPERVISOR`, and Linda with `FOREMAN` each return `401 UNAUTHENTICATED` with no worksite data; the unknown-user and Mark-mismatch response bodies are deep-equal (FR-005); an unknown caller asking for a worksite that does not exist gets `401`, not `404`; `GET /health` with no headers returns `200` (US2-1 to US2-6; SC-003).
- [X] T037 [P] [US2] Create `test/api/request-handling.api.test.ts`: as Linda, `GET /nowhere` returns `404 ROUTE_NOT_FOUND`; a `POST` with `Content-Type: application/json` and body `{` returns `400 MALFORMED_JSON` even with no actor headers (FR-022); a safe `X-Request-Id` is echoed; a missing one and an unsafe one (`bad id!`) are replaced by a generated UUID (FR-021 to FR-023).

**Checkpoint**: `npm run check`, `npm run test:int` and `npm run test:api` pass, including T027. Suggested commit: `feat(shared): check the actor against known users`.

---

## Phase 5: User Story 3 - The PRD example is present after startup (Priority: P2)

**Goal**: starting the system fills in the PRD example; running the seed command on purpose resets it ([contracts/seed-command.md](./contracts/seed-command.md)).

**Independent Test**: start from an empty database and find the example; change a task and start again: the change is kept; run the seed command: the PRD values are back, one copy of each row.

- [X] T038 [US3] Create `prisma/seed.ts` per research R6 and R7: export `EXAMPLE` with the users, worksite and tasks of data-model.md §4 and their fixed IDs; export `type SeedMode = "fill" | "reset"` and `loadExample(client: DatabaseClient, mode: SeedMode): Promise<void>`. `fill`: one `$transaction` with `createMany({ data, skipDuplicates: true })` for users, then worksites, then tasks (FR-018a). `reset`: one `$transaction` with an `upsert` by `id` for every example row, `update` setting every PRD value and never `createdAt` (FR-018b). Build the client with `createPrismaClient(loadConfig().databaseUrl)` and the logger with `createLogger(loadConfig().logLevel)`, from `src/config.ts` and `src/shared/infrastructure/`; do not read `process.env` (CFG-01). When run directly (`require.main === module`): mode is `reset` if `process.argv` contains `--reset`, else `fill`; log one `info` line with the mode using `createLogger` from `src/shared/infrastructure/logger.ts` (LOG-01, no `console.log`); on error log at `error` and set `process.exitCode = 1`; always `$disconnect()`.
- [X] T039 [US3] Create `test/integration/seed.int.test.ts` (each test starts with `truncateAll`): `fill` on an empty database creates exactly the PRD values (US3-1, US3-2); `fill` twice leaves 3 users, 1 worksite, 3 tasks (FR-018, SC-004); after `fill`, update walls to 55 and read its `updated_at`; `fill` again keeps 55 and exactly that `updated_at` (FR-018a, US3-4); with the example rows inserted through the helpers using the `EXAMPLE` values and IDs, timestamps `2000-01-01T00:00:00Z` and walls at 55, `reset` sets walls to 40, moves `updated_at` past 2000-01-01 and leaves `created_at` at 2000-01-01 (FR-018b, US3-5); `reset` and `fill` leave a non-example worksite and task unchanged (FR-018); after `fill`, the three tasks load through `PrismaWorksiteRepository` in the order Pour foundation, Build ground-floor walls, Install electrical.
- [X] T040 [US3] In `tsconfig.build.json`, change `include` to `["src/**/*.ts", "prisma/seed.ts"]`. Run `npm run build` and confirm `dist/prisma/seed.js` exists.
- [X] T041 [US3] In `package.json`, add `"prisma": { "seed": "tsx prisma/seed.ts --reset" }`. Run `npx prisma db seed` against the Compose database and confirm the log line says `reset`. A Prisma deprecation warning about `package.json#prisma` is expected (research R6).
- [X] T042 [US3] In `docker-compose.yml`, set the `migrate` command to `["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/prisma/seed.js"]` and replace the comment "The seed step is added together with the first models." with one saying the seed fills in missing example rows on every start.
- [X] T043 [P] [US3] In `http/report-flow.http`, add a comment table mapping each fixed user ID to Linda, Mark and Henry (FR-019), variables for the IDs, and three requests viewing the townhouse as Linda, Mark and Henry.
- [X] T044 [P] [US3] In `README.md` "Run it", say that startup loads the PRD townhouse example (Linda, Mark, Henry) and keeps existing data, that `npx prisma db seed` resets the example, and point to `http/report-flow.http` for the IDs.

**Checkpoint**: `npm run check` and `npm run test:all` pass, and `docker compose up --build` starts. Suggested commit: `feat(db): seed the townhouse example`.

---

## Phase 6: Polish and cross-cutting concerns

- [X] T045 [P] In `docs/engineering/architecture.md`, add §5.5 "Timestamps and list order": every table has `created_at` and `updated_at` (`timestamptz`, maintained by the `set_updated_at()` trigger), and lists are ordered by `updated_at` descending, then `created_at`, then `id`. In §8, change the `migrate` row to "Runs `prisma migrate deploy`, then the seed in fill mode, then exits."
- [X] T046 [P] In `docs/engineering/implementation-plan.md` step 1: in the Tests table, change "returns `200` with three tasks, for Linda and for Mark" to "returns `200` with three tasks for Linda, two for Mark and one for Henry"; in the What-to-implement table, add the timestamps and trigger to the Persistence row and the fill and reset modes to the Seed row; in the exit criteria, keep "as Linda returns the three tasks".
- [X] T047 [P] In `specs/001-worksite-seed/spec.md` Dependencies, replace the step 0 bullet with "Step 0 of the implementation plan: the constitution is written (v1.1.0) and awaits approval and the `chore: set up Spec-Kit` commit." In `specs/001-worksite-seed/checklists/requirements.md` Notes, replace the clarify-questions bullet with "The plan's clarify questions were settled in `/speckit-clarify` (2026-11-26)" and delete the constitution bullet.
- [X] T048 Run `npm run check`, `npm run test:all` and `npm run test:cov`. Confirm `domain` and `application` are at or above 90% lines and branches. Report the actual output.
- [X] T049 Run [quickstart.md](./quickstart.md) sections 2 to 5 against `docker compose up --build` and record the results (US3-6, SC-006).

**Suggested commit**: `docs: describe timestamps, list order and the seed`.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup. Blocks every story.
- **US1 (Phase 3)**: after Foundational.
- **US2 (Phase 4)**: after Foundational. T026 and T035 both edit `src/app.ts`, `src/main.ts` and `test/support/test-app.ts`, so if US1 and US2 run in parallel, do T035 after T026.
- **US3 (Phase 5)**: after Foundational. T039's last test uses `PrismaWorksiteRepository` (T018).
- **Polish (Phase 6)**: after all stories.

### Within each story

Domain → its unit tests → use case → its unit tests → repository → its integration tests → route and wiring → API tests. `npm run check` passes after each task group.

### Key task dependencies

- T003 → T004 → T005 → T006 → T007
- T008 → T009 → T011 → T012, T013
- T009, T010 → T014 → T015 → T016
- T017 → T018 → T019
- T020, T022, T023 → T024 → T025 → T026 → T027
- T028 → T029, T030 → T031; T030 → T032; T033 → T034; T030, T033 → T035 → T036, T037
- T038 → T039; T038 → T040 → T042; T038 → T041

## Parallel Examples

```text
# Phase 1
T001 assert-never.ts        T002 Role const object

# US1, once T009 is done
T010 worksite.repository.ts   T012 task.test.ts   T013 worksite.test.ts   T014 in-memory fake
# US1 interface
T020 validate-input.middleware.ts   T021 its test   T023 worksite.schemas.ts

# US2
T028 user.repository.ts   T029 in-memory fake
T036 identity.api.test.ts   T037 request-handling.api.test.ts

# Polish
T045 architecture.md   T046 implementation-plan.md   T047 spec notes
```

## Implementation Strategy

### MVP first

1. Phases 1 and 2.
2. Phase 3 (US1). Stop and validate: the worksite view works with test data, and the actor headers are checked for format only.
3. Phase 4 (US2) next, because without it any well-formed identity is accepted.

### Incremental delivery

Each checkpoint is a commit with a passing build (GIT-02): tables, then view, then identity, then seed, then documents. After Phase 5 the system starts with the PRD example and the shared exit criteria of the implementation plan (§1.1) can be checked.

## Notes

- No business rule (BR-x) is implemented here, so no test name starts with a rule ID. Test names cite the FR or scenario instead where it helps.
- `test/support/database.ts` row helpers are an addition to plan.md's file list; they serve TST-10 for integration and API tests.
- `test/api/health.api.test.ts` changes in T026 because `createApp` gains required dependencies.
- Found during T049: `docker compose up --build` rebuilt the image but kept an existing `api` container on the old one, because only `migrate` had `build: .`. `docker-compose.yml` now gives `api` the same `build: .`.
- `withValidInput`, `authenticate` and `logRequestError` each wrap a function that is unit-tested on its own (`parseInput`, `authenticate`, `logRequestError`), following the existing `resolveRequestId` pattern; the Express wrappers are covered by the API tests.
