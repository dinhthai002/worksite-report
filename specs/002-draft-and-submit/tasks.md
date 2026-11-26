---
description: "Task list for 002-draft-and-submit"
---

# Tasks: Draft and submit a daily report

**Input**: Design documents from `specs/002-draft-and-submit/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: required. Constitution principle VII and testing.md §1.1 require unit tests for domain,
use cases and middleware, integration tests for repositories and migrations, and API tests for
endpoints and middleware. Every row of the plan's test plan maps to a task below. A test for a
business rule starts its name with the rule ID (TST-01), for example
`it("BR-7 rejects submitting a report with no items")`.

**Organization**: grouped by user story. Within a story: domain and its unit tests, then the use
case and its unit tests, then the repository and its integration tests, then the route and its API
tests (constitution, Development Workflow).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story from spec.md (US1 to US4)

## Conventions for every task

- Read `AGENTS.md` and the files the task names before editing. Use glossary terms exactly.
- Production code under `src/` uses relative imports; tests import it as `@src/...` (TST-13).
- Every business rule in code cites its ID in a comment: `// BR-4` (DOC-02).
- Errors are `DomainError` subclasses from `src/shared/domain/errors.ts` with the codes in
  research R6, and the messages in [contracts/](./contracts/). `error-handler.ts` does not change.
- After each task that changes code, `npm run check` passes. Report the actual output.
- Integration and API tests need Docker: `npm run test:int`, `npm run test:api`.
- API tests send `X-Actor-Id`, `X-Actor-Role` and an `Idempotency-Key` (a fresh
  `crypto.randomUUID()`) on every `PUT` and `POST`, from the first test on, so they keep passing
  once the middleware is mounted in US3.
- Do not edit `tsconfig.json`, `biome.json`, `.dependency-cruiser.cjs` or the CI workflow, do not
  add ignore comments, and do not edit the committed migration of feature 001 (DB-05).
- Keep the file layout of plan.md (research R19): no extra files in `reporting/domain`.

---

## Phase 1: Setup (shared building blocks)

**Purpose**: move the IDs both modules use into `shared/domain`, and add `Progress`.

- [X] T001 Create `src/shared/domain/ids.ts` and move `WorksiteId`, `toWorksiteId` (from `src/modules/worksite/domain/worksite.ts`) and `TaskId`, `toTaskId` (from `src/modules/worksite/domain/task.ts`) into it unchanged, with their doc comments (research R1). Update `worksite.ts`, `task.ts`, `worksite.mapper.ts`, `get-worksite.ts` and every test and support file that imports them. `src/modules/worksite/index.ts` keeps exporting the same four names, now re-exported from `../../shared/domain/ids`. `npm run check` passes with no behavior change.
- [X] T002 [P] Create `src/shared/domain/progress.ts` (research R3): `MIN_PROGRESS = 0`, `MAX_PROGRESS = 100`; branded `export type Progress = number & { readonly [progressBrand]: true }`; `isProgress(value: number): value is Progress`, true when `Number.isInteger(value)` and `0 <= value <= 100`; `toProgress(value: number): Progress`, which throws `RangeError` naming the value otherwise. Create `test/unit/shared/domain/progress.test.ts`: `isProgress` is true for 0, 40 and 100, false for -1, 101, 55.5 and `NaN`; `toProgress(101)` throws `RangeError`.
- [X] T003 Change `Task.approvedProgress` and `TaskProps.approvedProgress` in `src/modules/worksite/domain/task.ts` from `number` to `Progress`, and remove the comment that anticipated it. In `src/modules/worksite/infrastructure/worksite.mapper.ts` convert with `toProgress(row.approvedProgress)` (the database `CHECK` guarantees the range). In `test/support/worksite.builder.ts`, `withApprovedProgress(n: number)` stores `toProgress(n)`. Adjust `test/unit/modules/worksite/**` and `test/integration/worksite.repository.int.test.ts` only where types require it. `npm run check` and `npm run test:int` pass.
- [X] T004 [P] Make 365 days the default backdating limit (spec FR-004, FR-037a; research R16). In `src/config.ts` export `DEFAULT_BACKDATE_LIMIT_DAYS = 365` and use it as the default of `BACKDATE_LIMIT_DAYS` in `environmentSchema` (was `5`). In `test/unit/config.test.ts`, the test of the defaults expects `backdateLimitDays` 365. Set `BACKDATE_LIMIT_DAYS=365` in `.env.example` and `BACKDATE_LIMIT_DAYS: "365"` in the `x-app-environment` block of `docker-compose.yml`. In `docs/engineering/architecture.md` §7, the default of `BACKDATE_LIMIT_DAYS` becomes `365`. Do not edit `docs/product/use-cases.md`: BR-2's "5 days" is changed by the product owner in a separate approved edit (spec, Conflicts between documents), checked by the merge gate in Phase 7. Your local `.env` is not in git: after this task, change its `BACKDATE_LIMIT_DAYS` to `365` by hand, or `npm run dev` keeps running with 5.

**Checkpoint**: suggested commits `refactor(shared): share worksite and task IDs, add Progress` and `feat(config): default the backdating limit to 365 days`.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the four tables, the core of the `DailyReport` aggregate, and its repository. Every story needs them.

**⚠️ CRITICAL**: no user story work starts until this phase is complete.

### Database

- [X] T005 Edit `prisma/schema.prisma` per data-model.md §2. Add `enum ReportStatus { DRAFT SUBMITTED REJECTED APPROVED @@map("report_status") }`. Add models, every field `camelCase` with `@map` to `snake_case` (NAM-06), timestamps `createdAt`/`updatedAt` as `DateTime @default(now()) @map(...) @db.Timestamptz(6)` with **no `@updatedAt`**, foreign keys `onDelete: Restrict`:
  - `DailyReport` (`@@map("daily_reports")`): `id String @id @db.Uuid`; `worksiteId` → `worksites(id)`; `authorId` → `users(id)`; `workDate DateTime @map("work_date") @db.Date`; `status ReportStatus @default(DRAFT)`; `version Int @default(1)`; `note String?`; relations `items ReportItem[]`, `transitions ReportTransition[]`; `@@unique([worksiteId, authorId, workDate])` (BR-1); `@@index([authorId])`.
  - `ReportItem` (`@@map("report_items")`): `reportId` → `daily_reports(id)`; `taskId` → `tasks(id)`; `reportedProgress Int @map("reported_progress")`; `note String?`; `@@id([reportId, taskId])` (BR-4); `@@index([taskId])`.
  - `ReportTransition` (`@@map("report_transitions")`): `id String @id @db.Uuid`; `reportId` → `daily_reports(id)`; `fromStatus ReportStatus @map("from_status")`; `toStatus ReportStatus @map("to_status")`; `actorId` → `users(id)`; `occurredAt DateTime @map("occurred_at") @db.Timestamptz(6)`; `reason String?`; `@@index([reportId, occurredAt])`.
  - `IdempotencyKey` (`@@map("idempotency_keys")`): `actorId` → `users(id)`; `key String`; `requestHash String @map("request_hash")`; `responseStatus Int? @map("response_status")`; `responseBody Json? @map("response_body")`; `completedAt DateTime? @map("completed_at") @db.Timestamptz(6)`; `@@id([actorId, key])` (BR-14).
  - Back-relation fields on `User`, `Worksite` and `Task`.
- [X] T006 Create the migration: `docker compose up -d db`, then `npx prisma migrate dev --create-only --name create_reporting_tables`. Append to the generated `prisma/migrations/<timestamp>_create_reporting_tables/migration.sql` a block headed `-- Hand-written (specs/002-draft-and-submit/data-model.md section 2.6)`, each statement with a comment citing its rule:
  - `ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_version_positive" CHECK ("version" >= 1);`
  - `ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_note_length" CHECK (char_length("note") <= 2000);`
  - `ALTER TABLE "report_items" ADD CONSTRAINT "report_items_reported_progress_range" CHECK ("reported_progress" BETWEEN 0 AND 100);` (BR-5)
  - `ALTER TABLE "report_items" ADD CONSTRAINT "report_items_note_length" CHECK (char_length("note") <= 2000);`
  - `ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_key_length" CHECK (char_length("key") BETWEEN 1 AND 255);`
  - `ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_completion" CHECK (("response_status" IS NULL) = ("completed_at" IS NULL) AND ("response_body" IS NULL) = ("completed_at" IS NULL));` (BR-14)
  - Triggers `daily_reports_set_updated_at`, `report_items_set_updated_at`, `report_transitions_set_updated_at`, `idempotency_keys_set_updated_at`: `BEFORE UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()` (the function exists since feature 001).
  - Function `"reject_report_transition_change"()` returning `TRIGGER` that runs `RAISE EXCEPTION 'report_transitions is append-only'`, and trigger `"report_transitions_append_only" BEFORE UPDATE OR DELETE ON "report_transitions" FOR EACH ROW EXECUTE FUNCTION "reject_report_transition_change"()` (BR-11, research R12).
  
  Apply with `npx prisma migrate dev`. Do not edit it after it is committed (DB-05).
- [X] T007 In `test/support/database.ts` add row helpers with valid defaults (TST-10), in the style of `insertTask`: `insertReport(client, row?)` (defaults: new ID, a new worksite and a new Foreman author when not given, `workDate` `2026-11-20`, status `DRAFT`, version 1, note `null`); `insertReportItem(client, row)` (`reportId` and `taskId` required, `reportedProgress` default 0, note `null`, optional timestamps); `insertTransition(client, row)` (`reportId` and `actorId` required, `fromStatus` `DRAFT`, `toStatus` `SUBMITTED`, `occurredAt` default `new Date("2026-11-20T10:00:00Z")`, new ID). `truncateAll` already covers the new tables.
- [X] T008 Create `test/integration/reporting-schema.int.test.ts` (each test starts with `truncateAll`):
  - `BR-1 the unique key rejects a second report for the same foreman, worksite and work date`, and accepts the same Foreman and date on another worksite.
  - `BR-4 the primary key rejects the same task twice in a report`.
  - `BR-5 reported_progress -1 and 101 are rejected by the database`; 0 and 100 are accepted.
  - `BR-11 report_transitions rejects UPDATE and DELETE` (both fail with `append-only` in the message; use the Prisma client, not raw SQL).
  - `BR-14 the primary key rejects a second claim of the same actor and key`; the same key for two actors is accepted; a row with `response_status` set and `completed_at` null is rejected.
  - A 2,001-character note is rejected on `daily_reports` and on `report_items`; 2,000 is accepted. `version` 0 is rejected.
  - For each new table except `report_transitions`, `updated_at` advances on update and `created_at` does not (architecture.md §5.5).

### Domain core

- [X] T009 Create `src/modules/reporting/domain/daily-report.ts` with the types every story uses (data-model.md §1.3, §1.4):
  - `ReportId` branded string and `toReportId`.
  - `ReportStatus` const object and type: `DRAFT`, `SUBMITTED`, `REJECTED`, `APPROVED`.
  - `ALLOWED_TRANSITIONS`: exactly `DRAFT→SUBMITTED`, `SUBMITTED→APPROVED`, `SUBMITTED→REJECTED`, `REJECTED→SUBMITTED`; `canTransition(from, to): boolean`; `assertTransition(from, to): void`, which throws `ConflictError("INVALID_STATUS_TRANSITION", "A <from> report cannot be <verb>. …", { from, to })` (FR-018); `isEditable(status)`: true for `DRAFT` and `REJECTED` (BR-6).
  - `WorkDate` branded string (`YYYY-MM-DD`) and `toWorkDate`.
  - `ReportTransition` interface: readonly `from`, `to`, `actorId: UserId`, `occurredAt: Date`, `reason: string | null` (BR-11).
  - `ReportWorksite` and `ReportTask` interfaces exactly as research R2, with a comment that `Worksite` from the `worksite` module fits them structurally and that ARC-01 forbids importing it.
  - Class `DailyReport` with readonly `id`, `worksiteId: WorksiteId`, `authorId: UserId`, `workDate`, `status`, `version: number`, `note: string | null`, `items: readonly ReportItem[]`, `transitions: readonly ReportTransition[]`, a private constructor, and `static restore(props)`. Nothing else yet: `create`, `edit`, `submit` and `assertViewableBy` come in the story phases.
- [X] T010 [P] Create `src/modules/reporting/domain/report-item.ts`: class `ReportItem` with readonly `taskId: TaskId`, `reportedProgress: Progress`, `note: string | null`; `static restore(props)`; `static create(taskId, reportedProgress: number, note)` which, when `!isProgress(reportedProgress)`, throws `RuleViolationError("PROGRESS_OUT_OF_RANGE", "The reported progress for task <taskId> must be a whole number from 0 to 100.", { taskId, reportedProgress, min: 0, max: 100 })` with the comment `// BR-5 (range)`. Create `test/unit/modules/reporting/domain/report-item.test.ts`: `BR-5 rejects reported progress -1 and 101, naming the task`; 0 and 100 are accepted.
- [X] T011 [P] Create `test/unit/modules/reporting/domain/daily-report.test.ts` with `describe("ReportStatus")`: a table-driven test over all 16 pairs of statuses (TST-11), built from the cartesian product of `Object.values(ReportStatus)`, asserting the 4 pairs above pass `assertTransition` and the other 12 throw `ConflictError` with code `INVALID_STATUS_TRANSITION`; `isEditable` is true exactly for `DRAFT` and `REJECTED`.
- [X] T012 [P] Create `src/modules/reporting/domain/daily-report.repository.ts`: the `DailyReportRepository` interface and `AddResult` type exactly as data-model.md §1.5, with the doc comments there.
- [X] T013 Create `src/modules/reporting/application/get-report.ts` with, for now, only `ReportView` and `toReportView(report: DailyReport): ReportView`: fields and order as [contracts/report-view.md](./contracts/report-view.md); `transitions[].occurredAt` from `toISOString()` (research R14); IDs as plain strings. `GetReport` is added in US4 (T047).

### Test support

- [X] T014 [P] Create `test/support/daily-report.builder.ts`: `aReport()` with valid defaults (TST-10): new `ReportId`, new worksite and author IDs, work date `2026-11-20`, `DRAFT`, version 1, note `null`, no items, no transitions. Methods: `withId`, `forWorksite(id)`, `by(authorId)`, `on(workDate)`, `withItems(...{ taskId, reportedProgress, note? })`, `withNoItems()`, `withNote`, `withVersion(n)`, `submitted()`, `rejected()`, `approved()` (each sets the status and adds the matching transitions), `build()` via `DailyReport.restore`.
- [X] T015 [P] Create `test/fakes/in-memory-daily-report.repository.ts`: `InMemoryDailyReportRepository implements DailyReportRepository` (TST-06). `add` returns `{ created: false, report: <existing> }` when a report with the same author, worksite and work date exists (BR-1), otherwise stores it with version 1. `save` throws `ConflictError("REPORT_VERSION_CONFLICT", …, { expectedVersion, currentVersion })` when the stored version differs from `expectedVersion`, otherwise stores the report with `version + 1` and returns it. Add a `stored(id)` helper for assertions.

### Infrastructure

- [X] T016 Create `src/modules/reporting/infrastructure/daily-report.mapper.ts` (ARC-08): `toDailyReport(row)` from a `daily_reports` row with its `items` and `transitions`; `workDate` formatted `YYYY-MM-DD` from the UTC date (`toISOString().slice(0, 10)`); `reportedProgress` via `toProgress`; `ReportStatus` via a `switch` ending in `assertNever` (TS-06). Transition `id` and all timestamps except `occurredAt` are not mapped (data-model.md §3).
- [X] T017 Create `src/modules/reporting/infrastructure/prisma-daily-report.repository.ts`: `PrismaDailyReportRepository implements DailyReportRepository`, constructor `(client: DatabaseClient)`. Every load includes items ordered `[{ updatedAt: "desc" }, { createdAt: "asc" }, { taskId: "asc" }]` and transitions ordered `[{ occurredAt: "asc" }, { id: "asc" }]` (FR-032).
  - `findById`, `findByAuthorWorksiteAndDate`: `findUnique`, mapped, or `undefined`.
  - `add`: one `$transaction` creating the report (with the given `id`, version 1) and its items. On `Prisma.PrismaClientKnownRequestError` with code `P2002`, load the report by author, worksite and work date: when found, return `{ created: false, report }` (BR-1, research R8); otherwise throw `ConflictError("REPORT_ALREADY_EXISTS", …)` (ERR-04). Any other error is rethrown.
  - `save(report, expectedVersion)`: one `$transaction` (DB-04, research R10, R11): `dailyReport.updateMany({ where: { id, version: expectedVersion }, data: { note, status, version: { increment: 1 } } })`; when `count` is 0, read the current version and throw `ConflictError("REPORT_VERSION_CONFLICT", "The report has changed since you read it (your version <e>, current version <c>). Reload it and try again.", { expectedVersion, currentVersion })` so the transaction rolls back (`// BR-15`). Then load the stored items and apply the difference: delete items whose task is gone, create new ones, update only those whose `reportedProgress` or `note` changed. Then count the report's stored transitions inside the transaction and insert `report.transitions.slice(storedCount)`, each with a new `crypto.randomUUID()` ID. Transitions are append-only, so the stored ones are always the first ones. Return the report reloaded inside the transaction.
- [X] T018 Create `test/integration/daily-report.repository.int.test.ts` (each test starts with `truncateAll`; build reports with `aReport()` against rows from the helpers):
  - Mapper round trip: a report with two items and a transition, added then loaded, equals the original apart from `version` (FR-031).
  - `BR-1 add returns the existing report with created false when the foreman already has one for the worksite and date`; the existing report is unchanged.
  - `BR-15 a save with a stale version updates zero rows, raises REPORT_VERSION_CONFLICT with the current version, and leaves items unchanged`.
  - `save` increments `version` by 1 and returns the stored report.
  - Item difference: after a save that changes one of three items, removes one and keeps one, the kept item's `updated_at` is unchanged, the removed item is gone, and the changed item is listed first (FR-002, FR-032, research R11).
  - Transitions load oldest first, by `occurred_at`, then `id` (FR-032).
  - `findByAuthorWorksiteAndDate` returns `undefined` for another author or date.

**Checkpoint**: `npm run check` and `npm run test:int` pass. Suggested commit: `feat(reporting): add the daily report tables and repository`.

---

## Phase 3: User Story 1 - Draft a report (Priority: P1) 🎯 MVP

**Goal**: `PUT /worksites/:worksiteId/reports/:workDate` creates a draft, returns the existing one (BR-1), or replaces its content ([contracts/save-draft.md](./contracts/save-draft.md)).

**Independent Test**: as Mark, save a draft for the townhouse on 20 November with walls at 55%, save again from version 1 with 60%: one report, `DRAFT`, 60%, version 2, approved progress unchanged. Each rule violation is refused with its code and changes nothing.

### Domain

- [X] T019 [US1] In `src/modules/reporting/domain/daily-report.ts` add `assertCanCreateReportFor(workDate, today, limitDays)` (BR-2, research R7): compute `earliest` = `today` minus `limitDays` days and `latest` = `today` by UTC calendar arithmetic on the `YYYY-MM-DD` strings; when `workDate < earliest` or `workDate > latest`, throw `RuleViolationError("WORK_DATE_OUT_OF_RANGE", "The work date <workDate> is outside the allowed range <earliest> to <latest>.", { workDate, earliest, latest })`. In `daily-report.test.ts` add `describe("BR-2 work date")`: `BR-2 rejects a future work date`; `BR-2 rejects a work date more than the limit before today` (today `2026-11-21`, limit 365, work date `2025-11-20`); `BR-2 accepts the boundary dates` (`2025-11-21` and `2026-11-21`); the message and details give both bounds; across a leap day (today `2028-03-01`, limit 365 → earliest `2027-03-02`); a small limit still works (limit 5 from `2026-12-02` → earliest `2026-11-27`).
- [X] T020 [US1] In `daily-report.ts` add to `DailyReport` (data-model.md §1.4):
  - `static assertCanAuthor(actor)`: role `FOREMAN`, else `ForbiddenError("ROLE_CANNOT_AUTHOR_REPORTS", "Only a foreman can create, edit or submit a report.", { role })`.
  - Private checks, each implemented once with its rule comment: `assertWorksiteActive(worksite)` (`// BR-3`, `RuleViolationError("WORKSITE_CLOSED", …, { worksiteId })`); `toItems(worksite, authorId, content.items)` (`// BR-4`: in order, `TASK_LISTED_TWICE`, `TASK_NOT_IN_WORKSITE` with `{ taskId, worksiteId }`, `TASK_NOT_ASSIGNED_TO_AUTHOR` with `{ taskId, taskName }`; then `ReportItem.create` for BR-5 range).
  - `static create({ id, author, worksite, workDate, today, backdateLimitDays, content })`: `assertCanAuthor`, BR-2, BR-3, items; returns a `DRAFT` report with version 1, no transitions.
  - `edit(actor, worksite, content)`: `assertCanAuthor`; author check (`// BR-6`, `ForbiddenError("NOT_REPORT_AUTHOR", …, { reportId })`); status check (`// BR-6`, `ConflictError("REPORT_NOT_EDITABLE", "The report is <status>. Only a DRAFT or REJECTED report can be changed.", { status })`); BR-3; items. Replaces `note` and the whole item list (FR-002); status unchanged. Does not check BR-2 (spec, Assumptions).
  
  `DailyReport` stays immutable: `edit` returns a new `DailyReport`.
- [X] T021 [US1] In `daily-report.test.ts` add `describe("create and edit")`, using `aWorksite()`/`aTask()` from `test/support/worksite.builder.ts`: `BR-3 rejects creating and editing for a CLOSED worksite`; `BR-4 rejects a duplicated task`, `BR-4 rejects a task of another worksite`, `BR-4 rejects a task assigned to another foreman`, each asserting the task in `details`; `BR-5 accepts progress below approved progress on save`; `BR-6 rejects edits by another foreman`; `BR-6 rejects edits in SUBMITTED and APPROVED, stating the status`; `BR-6 allows edits in REJECTED and keeps the status`; `BR-7 allows saving a draft with no items`; a Site Supervisor cannot create or edit (`ROLE_CANNOT_AUTHOR_REPORTS`); `edit` replaces the whole item list, so a left-out task is gone (US1-16).

### Application

- [X] T022 [US1] Create `src/modules/reporting/application/save-draft.ts`: class `SaveDraft`, constructor `(reports: DailyReportRepository, worksites: WorksiteRepository, clock: Clock, backdateLimitDays: number)`, with `WorksiteRepository` and `Worksite` imported from `../../worksite` (ARC-03). `execute(input: { actor; worksiteId; workDate; expectedVersion?: number; note: string | null; items })` returns `{ created: boolean; report: ReportView }`. Steps (research R4, R8):
  1. `DailyReport.assertCanAuthor(actor)`.
  2. Load the worksite, else `NotFoundError("WORKSITE_NOT_FOUND", "There is no worksite with ID <id>.", { worksiteId })`.
  3. `existing = reports.findByAuthorWorksiteAndDate(actor.id, worksiteId, workDate)`.
  4. No `expectedVersion` and `existing`: return `{ created: false, report: toReportView(existing) }` unchanged (`// BR-1`).
  5. No `expectedVersion` and no `existing`: `DailyReport.create` with `id: toReportId(randomUUID())` and `today: clock.today()`, then `reports.add`; return its result.
  6. `expectedVersion` and no `existing`: throw `REPORT_VERSION_CONFLICT` with `currentVersion: null` and the message `You have no report for this worksite and date. Reload it and save without a version.`
  7. `expectedVersion` differs from `existing.version`: throw `REPORT_VERSION_CONFLICT` with the current version (`// BR-15`).
  8. Otherwise `existing.edit(...)` then `reports.save(edited, expectedVersion)`; return `{ created: false, report }`.
- [X] T023 [US1] Create `test/unit/modules/reporting/application/save-draft.test.ts` with `InMemoryDailyReportRepository`, `InMemoryWorksiteRepository`, the builders and `FixedClock`:
  - creates a `DRAFT` with version 1 and `created: true` (US1-1);
  - `BR-1 saving again without a version returns the existing report unchanged`, with `created: false`, also when the work date is now outside the limit (US1-3);
  - saving with the current version replaces the note and the whole item list and returns version 2 (US1-2, US1-16);
  - `BR-2 today follows the configured time zone`: `new FixedClock("2026-11-20T18:30:00Z", "Asia/Ho_Chi_Minh")` accepts `2026-11-21` (US1-6), and the same instant with `"UTC"` refuses it;
  - `BR-15 rejects a save with a stale version, giving the current version`; a version with no report gives `currentVersion: null`;
  - unknown worksite → `WORKSITE_NOT_FOUND`; a Site Supervisor → `ROLE_CANNOT_AUTHOR_REPORTS` before the worksite is looked up;
  - a refused save leaves the stored report unchanged (US1-15).

### Interface and wiring

- [X] T024 [P] [US1] Create `src/modules/reporting/interface/report.schemas.ts` (API-01, research R5, R15): `saveDraftParams = z.object({ worksiteId: z.uuid(), workDate: z.iso.date() })`; `saveDraftBody = z.strictObject({ version: z.number().int().min(1).optional(), note: z.string().max(2000, "The note must be at most 2000 characters.").nullable().optional(), items: z.array(reportItemInput) })`, where `reportItemInput = z.strictObject({ taskId: z.uuid(), reportedProgress: z.number().int(), note: z.string().nullable().optional() })` with a refinement that adds an issue at path `["note"]` with the message `The note for task <taskId> is longer than 2000 characters.` when the note exceeds 2000 characters. No range on `reportedProgress`: BR-5 is the domain's (ARC-05).
- [X] T025 [US1] Create `src/modules/reporting/interface/report.routes.ts`: `reportRoutes(useCases: { saveDraft: SaveDraft }): Router` with `PUT /worksites/:worksiteId/reports/:workDate` through `withValidInput({ params: saveDraftParams, body: saveDraftBody }, …)`. The handler converts IDs with `toWorksiteId`, `toWorkDate`, `toTaskId`, passes `note ?? null` and each item's `note ?? null`, calls `saveDraft.execute` with `currentActor(res)`, and responds `201` when `created` and `expectedVersion` was absent, else `200`, with the `ReportView` (ARC-07).
- [X] T026 [US1] Update `src/modules/reporting/index.ts` to export `SaveDraft`, `PrismaDailyReportRepository`, `reportRoutes` and the `ReportView` type. In `src/app.ts` add `saveDraft: SaveDraft` to `AppDependencies` and mount `reportRoutes({ saveDraft })` after `worksiteRoutes`. In `src/main.ts` create `const clock = new SystemClock(config.appTimeZone)` and `new SaveDraft(new PrismaDailyReportRepository(prisma), worksites, clock, config.backdateLimitDays)`, reusing one `PrismaWorksiteRepository`. Update `test/support/test-app.ts` the same way, with a `FixedClock` at `2026-11-21T03:00:00Z` by default and an override for tests that need another day. The test app passes `DEFAULT_BACKDATE_LIMIT_DAYS` from `src/config.ts`, never a value read from the environment, so the API tests check BR-2 at the default (FR-037a).
- [X] T027 [US1] Create `test/api/save-draft.api.test.ts` (each test starts with `truncateAll`; data from the helpers; the app from `createTestApp` with today 21 November):
  - first save → `201`, `DRAFT`, `version` 1, the body of [contracts/report-view.md](./contracts/report-view.md);
  - edit with the version → `200`, `version` 2; first save again without a version → `200`, the existing report unchanged (BR-1);
  - `400` for `2026-02-30`, a non-UUID worksite, `reportedProgress` 55.5, a 2,001-character report note, a 2,001-character item note whose message names the task, and an unknown body field;
  - `404 WORKSITE_NOT_FOUND`;
  - `422` with the right code and `details` for: `2026-11-22` and `2025-11-20` (BR-2), a `CLOSED` worksite (BR-3), a duplicated task, a task of another worksite, another Foreman's task (BR-4), progress 101 (BR-5);
  - `409 REPORT_NOT_EDITABLE` for a `SUBMITTED` report prepared with `insertReport`;
  - after each refusal, the stored report is unchanged (FR-009);
  - `401 UNAUTHENTICATED` with no actor headers, and the request key is not claimed: the same key with valid headers then succeeds (constitution VII, testing.md §5).

**Checkpoint**: `npm run check`, `npm run test:int` and `npm run test:api` pass. US1 works on its own. Suggested commit: `feat(reporting): save a daily report draft`.

---

## Phase 4: User Story 2 - Submit a report for review (Priority: P1)

**Goal**: `POST /reports/:reportId/submit` moves a `DRAFT` or `REJECTED` report to `SUBMITTED` and records the transition ([contracts/submit-report.md](./contracts/submit-report.md)).

**Independent Test**: draft walls at 55% as Mark and submit with the current version: `SUBMITTED`, one transition `DRAFT → SUBMITTED` by Mark, walls still at 40%. Each refusal leaves the report unchanged.

### Domain

- [X] T028 [US2] In `daily-report.ts` add `submit(actor, worksite, at: Date): DailyReport` (data-model.md §1.4): `assertCanAuthor`; author check (BR-6, `NOT_REPORT_AUTHOR`); `assertTransition(status, SUBMITTED)`; BR-3; BR-7 (`// BR-7`, `RuleViolationError("REPORT_HAS_NO_ITEMS", "A report needs at least one item to be submitted.")`); for each item, BR-4 again (`TASK_NOT_ASSIGNED_TO_AUTHOR` when reassigned; `TASK_NOT_IN_WORKSITE` when missing) and BR-5 against approved progress (`// BR-5`, `RuleViolationError("PROGRESS_BELOW_APPROVED", "The reported progress for \"<taskName>\" is <reported>%, below its approved progress of <approved>%.", { taskId, taskName, reportedProgress, approvedProgress })`). Returns a new report with status `SUBMITTED` and one more `ReportTransition { from, to: SUBMITTED, actorId: actor.id, occurredAt: at, reason: null }` (`// BR-11`). Items unchanged.
- [X] T029 [US2] In `daily-report.test.ts` add `describe("submit")`: `BR-11 submitting records one transition with actor, time and no reason`, from `DRAFT` and from `REJECTED`; `BR-7 rejects submitting a report with no items`; `BR-5 rejects reported progress below approved progress on submit, naming the task and its approved progress` (30 vs 40); `BR-5 accepts reported progress equal to approved progress` (40); `BR-3 rejects submitting for a CLOSED worksite`; `BR-4 rejects submitting when a task has been reassigned to another foreman`; `BR-6 rejects submission by another foreman`; `SUBMITTED` and `APPROVED` reports throw `INVALID_STATUS_TRANSITION`; a Site Supervisor → `ROLE_CANNOT_AUTHOR_REPORTS`.

### Application

- [X] T030 [US2] Create `src/modules/reporting/application/submit-report.ts`: class `SubmitReport`, constructor `(reports: DailyReportRepository, worksites: WorksiteRepository, clock: Clock)`. `execute({ actor, reportId, expectedVersion }): Promise<ReportView>`: `assertCanAuthor`; load the report, else `NotFoundError("REPORT_NOT_FOUND", "There is no report with ID <id>.", { reportId })`; when `expectedVersion` differs from `report.version`, throw `REPORT_VERSION_CONFLICT` (`// BR-15`); load the worksite; `report.submit(actor, worksite, clock.now())`; `reports.save(submitted, expectedVersion)`; return `toReportView`.
- [X] T031 [US2] Create `test/unit/modules/reporting/application/submit-report.test.ts` with the fakes, builders and `FixedClock`: submits and returns version + 1 with the transition at `clock.now()` (US2-1); `BR-15 rejects a submission with a stale version`; unknown report → `REPORT_NOT_FOUND` (US2-13); every task's `approvedProgress` in the worksite fake is unchanged afterwards (US2-2, FR-016); a refused submission leaves the stored report unchanged.

### Interface and wiring

- [X] T032 [US2] In `report.schemas.ts` add `reportParams = z.object({ reportId: z.uuid() })` and `submitReportBody = z.strictObject({ version: z.number().int().min(1) })`. In `report.routes.ts` add `submitReport: SubmitReport` to the use cases and `POST /reports/:reportId/submit` through `withValidInput`, responding `200` with the `ReportView`.
- [X] T033 [US2] Export `SubmitReport` from `src/modules/reporting/index.ts`; add `submitReport` to `AppDependencies` in `src/app.ts`, to `src/main.ts` (same `clock` and repositories) and to `test/support/test-app.ts`.
- [X] T034 [US2] Create `test/api/submit-report.api.test.ts`: `200` with `SUBMITTED`, `version` increased and one transition (`occurredAt` ISO 8601 with `Z`); `400` for a missing or non-integer `version` and a non-UUID ID; `404 REPORT_NOT_FOUND`; `409` for a stale version (`REPORT_VERSION_CONFLICT` with `currentVersion`) and for a `SUBMITTED` report (`INVALID_STATUS_TRANSITION`); `422` for no items, progress below approved, a `CLOSED` worksite (close it after the save with a direct update), a task reassigned after the save; from `REJECTED` (prepared with `insertReport` and `insertTransition`) → `200` with a `REJECTED → SUBMITTED` transition; the task's `approved_progress` row is unchanged after every case; `401 UNAUTHENTICATED` with no actor headers (constitution VII).
- [X] T035 [P] [US2] Create `test/api/permissions.api.test.ts` (testing.md §5): a Site Supervisor saving and submitting → `403 ROLE_CANNOT_AUTHOR_REPORTS`; Mark reporting on Henry's task → `422 TASK_NOT_ASSIGNED_TO_AUTHOR`; Henry submitting Mark's report → `403 NOT_REPORT_AUTHOR` (US1-9, US1-14, US2-11, US2-12).
- [X] T036 [P] [US2] Create `test/api/report-flow.api.test.ts` with the seeded example (run `loadExample(client, "fill")` from `prisma/seed.ts` after truncation) and today 21 November: Mark drafts walls at 55% for `2026-11-20`, edits the note, submits; the report is `SUBMITTED` with one transition, and `GET /worksites/<townhouse>` as Linda still shows walls at 40% (SC-001; implementation plan step 2 exit criterion). Leave a comment that features 003 and 004 extend this file.

**Checkpoint**: `npm run check` and `npm run test:all` pass. Suggested commit: `feat(reporting): submit a daily report`.

---

## Phase 5: User Story 3 - Retries never duplicate, and stale copies never overwrite (Priority: P1)

**Goal**: every `POST` and `PUT` carries an `Idempotency-Key`; a retry replays the stored answer; concurrent writes resolve to exactly one ([contracts/idempotency.md](./contracts/idempotency.md)).

**Independent Test**: five identical saves with one key → one report, five identical responses; two saves from one version → one `200`, one `409`.

### Middleware

- [X] T037 [US3] Create `src/shared/infrastructure/http/idempotency.middleware.ts` (research R9):
  - The port, declared here (research R19): `IdempotencyKeyRepository` with `claim(actorId, key, requestHash): Promise<boolean>` (true when inserted), `find(actorId, key): Promise<StoredKey | undefined>` with `StoredKey = { requestHash; responseStatus: number | null; responseBody: unknown }`, `complete(actorId, key, status, body): Promise<void>`, `release(actorId, key): Promise<void>`.
  - `IDEMPOTENCY_KEY_HEADER = "idempotency-key"`; a Zod schema: string of 1 to 255 characters matching `/^[\x21-\x7E]+$/`. Missing or invalid: `next(zodError)` with issue path `headers.idempotency-key`, so the error handler returns `400 VALIDATION_FAILED`.
  - `requestHash(method, originalUrl, body)`: SHA-256 hex (`node:crypto`) of the method, the URL and `canonicalJson(body ?? null)`, where `canonicalJson` sorts object keys recursively. A request with no body hashes as `null`, so a retry without a body matches its original.
  - `idempotencyMiddleware(keys): RequestHandler`, acting only on `POST` and `PUT`, using `currentActor(res)`. Claimed: wrap `res.json` so that a status below 400 calls `complete` and a status of 400 or more calls `release`, and only then sends; a failure of that write goes to `next`. Not claimed: `find`; different hash → `RuleViolationError("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different request. Use a new key.")`; same hash and `responseStatus` null → `ConflictError("IDEMPOTENCY_KEY_IN_PROGRESS", "The original request with this Idempotency-Key is still being processed. Retry it later.")`; same hash and completed → `res.status(stored).json(stored body)` without calling `next`. Comment `// BR-14` on the middleware.
- [X] T038 [P] [US3] Create `test/fakes/in-memory-idempotency-key.repository.ts`: `InMemoryIdempotencyKeyRepository implements IdempotencyKeyRepository`, keyed by actor and key, with a helper to pre-load an in-progress claim.
- [X] T039 [US3] Create `test/unit/shared/infrastructure/http/idempotency.middleware.test.ts`. Call `idempotencyMiddleware(store)` directly, as `actor.middleware.test.ts` does, with no server and no supertest (TST-04): a fake request `{ method, originalUrl, body, get(name) }`, a fake response `{ locals: { actor }, statusCode, status(code), json(body) }` that records what was sent, a `next` spy, and `InMemoryIdempotencyKeyRepository`. Cases: `BR-14 lets a first request through and stores its response` (`next` called once; after `res.status(201).json(body)` the store holds 201 and the body); `BR-14 replays a completed request without calling next`; `BR-14 rejects a reused key with a different body` (`next` receives `IDEMPOTENCY_KEY_REUSED`); `BR-14 reports a key still in progress` (pre-loaded claim; `next` receives `IDEMPOTENCY_KEY_IN_PROGRESS`); the key is released after `res.status(422).json(…)` and after `res.status(500).json(…)`; the same key from two actors is claimed twice; a missing key and a 256-character key pass a `ZodError` to `next` with path `headers.idempotency-key`; `GET` calls `next` without a key; `canonicalJson` gives the same hash for `{a:1,b:2}` and `{b:2,a:1}`. The HTTP-level behavior is covered by T043.

### Infrastructure

- [X] T040 [US3] Create `src/shared/infrastructure/prisma-idempotency-key.repository.ts`: `PrismaIdempotencyKeyRepository implements IdempotencyKeyRepository`. `claim`: `idempotencyKey.createMany({ data: [{ actorId, key, requestHash }], skipDuplicates: true })` (`INSERT … ON CONFLICT DO NOTHING`), true when `count` is 1; `find`: `findUnique`; `complete`: `update` setting `responseStatus`, `responseBody` and `completedAt: new Date()`; `release`: `deleteMany({ where: { actorId, key, completedAt: null } })`.
- [X] T041 [US3] Create `test/integration/idempotency-key.repository.int.test.ts`: `BR-14 a second claim of the same actor and key returns false`; the same key for another actor returns true; `complete` then `find` returns the status and body; `release` deletes an in-progress claim and leaves a completed one.

### Wiring and API

- [X] T042 [US3] In `src/app.ts` add `idempotencyKeys: IdempotencyKeyRepository` to `AppDependencies` and mount `app.use(idempotencyMiddleware(dependencies.idempotencyKeys))` right after the actor middleware (architecture.md §6, step 3). Wire `PrismaIdempotencyKeyRepository` in `src/main.ts` and `test/support/test-app.ts`. Run `npm run test:api`: every earlier API test still passes because it already sends a key.
- [X] T043 [US3] Create `test/api/idempotency.api.test.ts` (SC-002): five identical first saves with one key → one row in `daily_reports` and five responses with identical status and body (UC-1 acceptance); a repeated submission with the same key → the original `200`, one transition; the same key with another body → `422 IDEMPOTENCY_KEY_REUSED` and nothing changes; a missing key → `400`; Mark's and Henry's identical key values do not interfere; two concurrent identical requests with one key via `Promise.allSettled` → one report, and the pair of outcomes is either one success and one `409 IDEMPOTENCY_KEY_IN_PROGRESS` or two identical successes (research R18).
- [X] T044 [P] [US3] Create `test/api/concurrency.api.test.ts` with `Promise.allSettled` (testing.md §4): `BR-15 two saves from the same version: one 200, one 409 with the current version`, and the stored report holds the winner's content (SC-003); `BR-1 ten concurrent first saves create one report`: one `201`, nine `200`, all with the same report ID (SC-004).

**Checkpoint**: `npm run check` and `npm run test:all` pass. Suggested commit: `feat(shared): replay requests with the same Idempotency-Key`.

---

## Phase 6: User Story 4 - View a report and its history (Priority: P2)

**Goal**: `GET /reports/:reportId` returns the report, its items and its transitions to the author, and to the worksite's Site Supervisor once submitted ([contracts/get-report.md](./contracts/get-report.md)).

**Independent Test**: draft and submit Mark's report, view it as Mark and as Linda (`200`), view the draft as Linda and the report as Henry (`403`), and an unknown ID (`404`).

**Gate (met 2026-11-26, commit 93912c8)**: before T045, the product owner has approved and committed the `docs(product)` change to the PRD Roles table ("View worksites, tasks, and reports") and a use case for viewing a report (spec FR-030, Conflicts between documents; constitution I). If it is not committed, stop and ask. Do not build FR-030 against the old PRD row.

- [ ] T045 [US4] In `daily-report.ts` add `assertViewableBy(actor, worksite)` (`// FR-030`, research R13): allowed for the author; allowed for `worksite.supervisorId === actor.id` unless the status is `DRAFT`; otherwise `ForbiddenError("REPORT_VIEW_FORBIDDEN", "You may not view this report. Only its author, and the worksite's site supervisor once it is submitted, may view it.", { reportId })`.
- [ ] T046 [US4] In `daily-report.test.ts` add `describe("who may view")`: the author in every status; the worksite's Site Supervisor in `SUBMITTED`, `REJECTED`, `APPROVED` but not `DRAFT`; another Foreman and the Site Supervisor of another worksite in every status are refused.
- [ ] T047 [US4] In `src/modules/reporting/application/get-report.ts` add class `GetReport`, constructor `(reports: DailyReportRepository, worksites: WorksiteRepository)`; `execute({ actor, reportId })`: load the report, else `REPORT_NOT_FOUND`; load its worksite; `report.assertViewableBy(actor, worksite)`; return `toReportView(report)`. Writes nothing (FR-033). Create `test/unit/modules/reporting/application/get-report.test.ts`: returns the view with items and transitions in order; `REPORT_NOT_FOUND`; `REPORT_VIEW_FORBIDDEN` for Linda on a draft.
- [ ] T048 [US4] In `report.routes.ts` add `getReport: GetReport` and `GET /reports/:reportId` through `withValidInput({ params: reportParams }, …)`, responding `200`. Export `GetReport` from `src/modules/reporting/index.ts`; wire it in `src/app.ts`, `src/main.ts` and `test/support/test-app.ts`.
- [ ] T049 [US4] Create `test/api/get-report.api.test.ts`: as the author, `200` with items, transitions oldest first and `version`; a draft has `transitions: []`; Linda gets `200` for a submitted report and `403 REPORT_VIEW_FORBIDDEN` for a draft; Henry and a supervisor of another worksite get `403`; `404 REPORT_NOT_FOUND`; `400` for a non-UUID ID, a query parameter and a non-empty body; the report's `version` and `updated_at` are unchanged after viewing; `401 UNAUTHENTICATED` with no actor headers (constitution VII).

**Checkpoint**: `npm run check` and `npm run test:all` pass. Suggested commit: `feat(reporting): view a daily report and its history`.

---

## Phase 7: Polish and cross-cutting concerns

**Merge gate (met 2026-11-26, commit 93912c8)**: before the feature is merged, `docs/product/` has the product owner's approved changes, in one `docs(product)` commit: the PRD Roles table and the viewing use case (Phase 6 gate); BR-2 in `use-cases.md` with 365 days instead of 5 (T004); and UC-2's "Applies" line listing BR-11, BR-14 and BR-15 (open question P4). Check them during T054. Until then the branch is not merged (constitution I).

- [ ] T050 [P] In `http/report-flow.http` add, after the existing requests, named requests using the same variables and a `@reportId` captured from the first response: Mark drafts walls at 55% for `2026-11-20`; Mark adds a note from version 1; Mark submits from version 2; Linda views the report; Linda views the townhouse (walls still 40). Each `PUT` and `POST` has its own `Idempotency-Key`, and a comment explains that repeating a request with the same key replays the first answer (FR-037).
- [ ] T051 [P] In `README.md` "Run it", add: reports are not part of the example data, so to repeat the walkthrough from scratch run `docker compose down -v` first.
- [ ] T052 [P] In `docs/engineering/architecture.md` §5.4, describe the middleware as built (research R9): the key is claimed first; a duplicate in flight gets `409 IDEMPOTENCY_KEY_IN_PROGRESS`; the response is stored before it is sent; a request that fails or is refused releases the key; a missing key is a `400`. In §6, step 7, add "on failure, the key is released".
- [ ] T053 [P] In `docs/engineering/implementation-plan.md` step 2: Persistence row, `report_items` primary key `(report_id, task_id)` and `idempotency_keys` primary key `(actor_id, key)`; Tests rows, the same-key concurrency test as research R18, `GET /reports/:id` permission cases, BR-5 range returning `422`, and BR-2 tested at the 365-day default. Do not edit `docs/product/`.
- [ ] T054 Run `npm run check`, `npm run test:all` and `npm run test:cov` and report the actual output; `domain` and `application` stay at or above 90% lines and branches. Run `grep -rhoE "BR-(1|2|3|4|5|6|7|11|14|15)\b" test | sort -u` and confirm all ten rules appear in test names (TST-01).
- [ ] T055 Run [quickstart.md](./quickstart.md) sections 2 to 7 against `docker compose up --build` and record any difference from the expected results (SC-008).

**Suggested commit**: `docs: describe request keys and the report walkthrough`.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none. T003 after T002. T004 is independent, but before T026, which uses its constant.
- **Foundational (Phase 2)**: after Setup. Blocks every story.
- **US1 (Phase 3)**: after Foundational.
- **US2 (Phase 4)**: after US1. `submit` needs a saved report, and T032, T033 extend the files T025, T026 create.
- **US3 (Phase 5)**: after Foundational for T037 to T041; T042 to T044 after US1 and US2, because they exercise both endpoints.
- **US4 (Phase 6)**: after Foundational for T045 to T047; T048, T049 after US2, because they need a submitted report and extend `report.routes.ts`.
- **Polish (Phase 7)**: after all stories.

### Shared files edited in sequence

`daily-report.ts` (T009, T019, T020, T028, T045), `daily-report.test.ts` (T011, T019, T021, T029, T046), `report.routes.ts` and `report.schemas.ts` (T024, T025, T032, T048), and `src/app.ts`, `src/main.ts`, `test/support/test-app.ts` (T026, T033, T042, T048). Tasks touching the same file run in ID order.

### Key task dependencies

- T001 → T002 → T003; T004 → T026
- T005 → T006 → T007 → T008
- T009 → T010, T011, T012 → T013, T014, T015 → T016 → T017 → T018
- T019 → T020 → T021 → T022 → T023 → T024 → T025 → T026 → T027
- T028 → T029 → T030 → T031 → T032 → T033 → T034, T035, T036
- T037, T038 → T039; T040 → T041; T039, T041 → T042 → T043, T044
- T045 → T046 → T047 → T048 → T049

## Parallel Examples

```text
# Foundational, once T009 is done
T010 report-item.ts + test   T011 status table test   T012 repository port
# Foundational, once T013 is done
T014 report builder          T015 in-memory report repository
# US2 API tests, once T033 is done
T034 submit-report.api       T035 permissions.api      T036 report-flow.api
# US3, alongside US1/US2 work
T037 middleware → T039       T038 fake                 T040 Prisma store → T041
# Polish
T050 report-flow.http   T051 README   T052 architecture.md   T053 implementation-plan.md
```

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1 and Phase 2.
2. Phase 3 (US1): a Foreman can save and edit drafts.
3. Stop and validate: `npm run test:all`, then `PUT` a draft by hand.

### Incremental delivery

1. US1: drafts, with BR-1 to BR-6 on save and BR-15 on edits.
2. US2: submission, BR-7 and BR-11; the PRD example's first row.
3. US3: request keys on every write; the concurrency guarantees proven end to end.
4. US4: viewing a report, with the permission rule from clarify.
5. Polish: walkthrough, documents, full checks.

Each phase ends with a commit whose build and tests pass (GIT-02).

## Plan test-row coverage

| Plan test plan row | Task |
| --- | --- |
| `Progress` | T002 |
| TST-11 status pairs | T011 |
| BR-2 bounds; time zone | T019; T023 |
| BR-3 | T021, T029, T027, T034 |
| BR-4 save and submit | T021, T029, T027, T034, T035 |
| BR-5 range; against approved | T010, T021, T027; T029, T034 |
| BR-6 | T021, T029, T027, T034, T035 |
| BR-7 | T021, T029, T034 |
| BR-11 | T029, T034, T008 |
| Supervisor cannot author | T021, T029, T035 |
| `assertViewableBy` | T046 |
| `SaveDraft` create, BR-1, edit, BR-15, not found | T023 |
| `SubmitReport` stale, not found, approved progress unchanged | T031 |
| BR-14 middleware | T039 |
| Integration: BR-1, BR-4, BR-5, BR-11, BR-14 constraints, note length | T008 |
| Integration: BR-15, round trip, order, item difference, BR-1 `add` | T018 |
| Integration: idempotency store | T041 |
| API: save, submit, view | T027, T034, T049 |
| API: idempotency, concurrency, permissions, flow | T043, T044, T035, T036 |
| Manual: quickstart, `report-flow.http` | T050, T055 |
