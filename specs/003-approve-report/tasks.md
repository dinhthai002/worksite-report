---
description: "Task list for 003-approve-report"
---

# Tasks: Approve a daily report

**Input**: Design documents from `specs/003-approve-report/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: required. Constitution principle VII and testing.md §1.1 require unit tests for domain
and use cases, integration tests for the repository, and API tests for the endpoint. Every row of
the plan's test plan maps to a task below (see "Plan test-row coverage"). A test for a business
rule starts its name with the rule ID (TST-01), for example
`it("BR-12 rejects approval by a supervisor of another worksite")`.

**Organization**: the approval write (port method, Prisma implementation, its integration test,
the fake) is foundational, so the build passes after every task. The approve method and the
endpoint are then built completely in US1, including the BR-12 and BR-5 checks, so no commit ever
exposes an approval without its permission and progress guards. US2 to US4 prove each guarantee at
the integration and API layers. Within a story: domain and its unit tests, then the use case and
its unit tests, then the repository and its integration tests, then the route and its API tests.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story from spec.md (US1 to US5)

## Conventions for every task

- Read `AGENTS.md` and the files the task names before editing. Use glossary terms exactly.
- Production code under `src/` uses relative imports; tests import it as `@src/...` (TST-13).
- Every business rule in code cites its ID in a comment: `// BR-12` (DOC-02).
- Errors are `DomainError` subclasses from `src/shared/domain/errors.ts` with the codes and
  messages in [contracts/approve-report.md](./contracts/approve-report.md). `error-handler.ts` does
  not change.
- After each task that changes code, `npm run check` passes. Report the actual output.
- Integration and API tests need Docker: `npm run test:int`, `npm run test:api`.
- API tests send `X-Actor-Id`, `X-Actor-Role` and a fresh `Idempotency-Key` on every `POST`, through
  the `Caller` helper in `test/support/townhouse.ts`.
- Concurrency tests use `Promise.allSettled` and assert on the set of outcomes (research R9).
- Do not edit `tsconfig.json`, `biome.json`, `.dependency-cruiser.cjs`, the CI workflow, any
  committed migration, `docs/product/` or `docs/adr/`. Do not add ignore comments.
- Keep the `reporting` file layout (002 research R19): no new files in `reporting/domain`.
  `src/modules/worksite/` and `prisma/` do not change (plan, Project Structure).

---

## Phase 1: Setup (prerequisite and test helpers)

**Purpose**: confirm feature 002 is complete, and add the test helpers every story uses.

**⚠️ Gate**: before T002, feature 002 is complete (plan, Prerequisite).

- [X] T001 Confirm feature 002 is done: every task T045 to T055 in `specs/002-draft-and-submit/tasks.md` is checked; `src/modules/reporting/interface/report.routes.ts` has `GET /reports/:reportId`; `http/report-flow.http` has Mark's draft, edit and submission for `2026-11-20`; and `npm run test:all` passes on `main`. If any is missing, stop and ask; do not start T002.
- [X] T002 [P] In `test/support/townhouse.ts` add `Caller.approve(reportId: string, body: unknown, key: string = randomUUID()): request.Test`, sending `POST /reports/${reportId}/approve` with `Idempotency-Key`, the same way as `Caller.submit`.
- [X] T003 [P] In `test/fakes/in-memory-worksite.repository.ts` store worksites in a `Map<WorksiteId, Worksite>` and add `replace(worksite: Worksite): void`, documented as a test-only way for the fake report repository to record new approved progress (research R8). `findById` is unchanged in behavior.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the error factory and the approval write every story depends on: the port method, its Prisma implementation with an integration test, and the fake.

- [X] T004 In `src/modules/reporting/domain/daily-report.ts` add `export interface OutdatedItem { readonly taskId: TaskId; readonly taskName: string; readonly reportedProgress: Progress; readonly approvedProgress: Progress }` and `export function progressOutdated(items: readonly OutdatedItem[]): RuleViolationError` (`// BR-5`, research R3). Code `REPORT_PROGRESS_OUTDATED`; `details` `{ tasks: items }` in the order given; message `This report cannot be approved: approved progress is already above it for <n> task(s). "<taskName>": reported <r>%, approved <a>%. ... Reject the report so its author can update it.`, one `"<taskName>": reported <r>%, approved <a>%.` sentence per item, `task` for 1 and `tasks` otherwise.
- [X] T005 In `src/modules/reporting/domain/daily-report.repository.ts` add `saveApproval(report: DailyReport, expectedVersion: number): Promise<DailyReport>` with the doc comment of data-model.md §1.3 (one transaction; report conditional on `expectedVersion` and status `SUBMITTED`; each task raised to the reported progress only when below it, in ascending task ID order, and a task not raised must not be above it; the transition; throws `REPORT_VERSION_CONFLICT` or `REPORT_PROGRESS_OUTDATED`; returns the report as stored). `PrismaDailyReportRepository` and the fake implement it in T006 and T008.
- [X] T006 In `src/modules/reporting/infrastructure/prisma-daily-report.repository.ts` implement `saveApproval(report, expectedVersion)` as research R4, in one `this.client.$transaction`:
  1. `tx.dailyReport.updateMany({ where: { id: report.id, version: expectedVersion, status: "SUBMITTED" }, data: { status: report.status, version: { increment: 1 } } })` (`// BR-15`, ADR 0004); `count === 0` → `throw await versionConflict(tx, report.id, expectedVersion)`.
  2. For each item **sorted by `taskId` ascending** (`// research R4: one lock order, so concurrent approvals cannot deadlock`): `tx.task.updateMany({ where: { id: item.taskId, worksiteId: report.worksiteId, approvedProgress: { lt: item.reportedProgress } }, data: { approvedProgress: item.reportedProgress } })` (`// BR-9: raise only; a task already at the reported value is not written, so it keeps its place in the worksite's list (Clarifications)`); collect the items whose `count === 0`.
  3. If any were collected: `tx.task.findMany({ where: { id: { in: [...] }, worksiteId: report.worksiteId }, select: { id, name, approvedProgress } })`. A collected task that is missing is a plain `Error`. The tasks whose `approvedProgress` is above the item's `reportedProgress` are outdated (`// BR-5 guard`); tasks equal to it are fine. If any are outdated, `throw progressOutdated(...)`, in the report's item order, with `toProgress` on both figures. The throw rolls the transaction back.
  4. `await appendTransitions(tx, report)`.
  5. Return `toDailyReport(await tx.dailyReport.findUniqueOrThrow({ where: { id: report.id }, include: WITH_CHILDREN }))`.
  Comment at the method that this is the only write by `reporting` to a table owned by `worksite` (ADR 0004).
- [X] T007 In `test/integration/daily-report.repository.int.test.ts` add `describe("saveApproval")` with two tests:
  - `BR-9 approval writes the status, version + 1, the transition and every item's task, and no other task` (a submitted report with two items in a worksite with three tasks; assert the `daily_reports`, `report_transitions` and `tasks` rows) (FR-002, FR-004, FR-010).
  - `BR-9 a task reported at its current approved progress is not written`: its `approved_progress` and `updated_at` are unchanged, while the other item's task is raised (US1-4, FR-002; Clarifications).
- [X] T008 In `test/fakes/in-memory-daily-report.repository.ts` take an optional second constructor argument `worksites?: InMemoryWorksiteRepository` and implement `saveApproval`: reject with `REPORT_VERSION_CONFLICT` (same details as `save`) when the stored version differs or the stored status is not `SUBMITTED`; load the worksite (throw `Error` when the fake has none); for every item, find the task and, when its `approvedProgress` is above the item's `reportedProgress`, collect it; if any were collected, reject with `progressOutdated(collected)` and change nothing; otherwise `worksites.replace(...)` with a worksite rebuilt by `Worksite.restore` and `Task.restore`, every item's task at its reported progress, and store the report at `expectedVersion + 1`. Validate everything before writing anything, so the fake is all or nothing like the real one.

**Checkpoint**: `npm run check` and `npm run test:int` pass. T005 and T006 go in the same commit, because the Prisma repository must implement the port for the typecheck to pass. Suggested commit: `feat(reporting): write an approval in one transaction`.

---

## Phase 3: User Story 1 - Approve a submitted report (Priority: P1) 🎯 MVP

**Goal**: `POST /reports/:reportId/approve` moves a `SUBMITTED` report to `APPROVED`, records the transition, and sets every item's task to its reported progress, guarded by BR-12, BR-10 and BR-5 ([contracts/approve-report.md](./contracts/approve-report.md)).

**Independent Test**: as Linda, approve Mark's submitted report (walls at 55%) with its current version: `APPROVED`, version + 1, one more transition `SUBMITTED → APPROVED` by Linda; the townhouse shows walls 55, foundation 100, electrical 0.

### Domain

- [X] T009 [US1] In `src/modules/reporting/domain/daily-report.ts` add to `DailyReport`:
  - `assertCanApprove(actor: Actor, worksite: ReportWorksite): void` (`// BR-12`, and `// FR-009: a DRAFT gets BR-12's answer`, research R2): allowed only when `actor.role === Role.SITE_SUPERVISOR`, `actor.id === worksite.supervisorId` and `this.status !== ReportStatus.DRAFT`; otherwise `ForbiddenError("REPORT_APPROVAL_FORBIDDEN", "You may not approve this report. Only the site supervisor of its worksite may approve it, once it is submitted.", { reportId: this.id })`, identical in every case.
  - `approve(actor: Actor, worksite: ReportWorksite, at: Date): DailyReport` (data-model.md §1.2): `assertCanApprove`; `assertTransition(this.status, ReportStatus.APPROVED)` (`// BR-10`); for **every** item find its task in `worksite.tasks` (throw a plain `Error` when missing) and collect an `OutdatedItem` when `item.reportedProgress < task.approvedProgress` (`// BR-5`); if any, throw `progressOutdated(collected)`; return a new report with status `APPROVED` and one more `ReportTransition { from: SUBMITTED, to: APPROVED, actorId: actor.id, occurredAt: at, reason: null }` (`// BR-11`). Do not check the worksite's status (BR-3) or the assignee (BR-4) (`// FR-008`). Items and note unchanged.
- [X] T010 [US1] In `test/unit/modules/reporting/domain/daily-report.test.ts` add `describe("approve")` with `aReport()`, `aWorksite()`, `aTask()`:
  - `BR-11 approving records one transition SUBMITTED to APPROVED with the supervisor, the time and no reason`; items and note unchanged (US1-1, FR-005).
  - `BR-12 rejects approval by a foreman, including the author` and `BR-12 rejects approval by a supervisor of another worksite` (US3-1 to US3-3).
  - `rejects approval of a DRAFT with exactly the BR-12 refusal`: same `code`, `message` and `details` as the other-supervisor case (US3-6, FR-009).
  - `BR-10 an APPROVED report cannot be approved again` (`INVALID_STATUS_TRANSITION`, `from` `APPROVED`), `BR-10 an APPROVED report cannot be edited` (`REPORT_NOT_EDITABLE`), `BR-10 an APPROVED report cannot be submitted` (`INVALID_STATUS_TRANSITION`) (US3-4, US3-5).
  - A `REJECTED` report: `INVALID_STATUS_TRANSITION` with `from` `REJECTED` (US3-7).
  - `BR-5 rejects approval when a task's approved progress is above the reported progress, naming the task and both figures` (40 vs 60) (US2-1).
  - `BR-5 lists every outdated task, in item order` (two stale items) (US2-4, SC-007).
  - `BR-5 accepts reported progress equal to approved progress` (US1-4).
  - Accepts a `CLOSED` worksite and a task now assigned to another foreman (US1-5, US1-6, FR-008).

### Application

- [X] T011 [US1] Create `src/modules/reporting/application/approve-report.ts`: class `ApproveReport`, constructor `(reports: DailyReportRepository, worksites: WorksiteRepository, clock: Clock)`; `execute({ actor, reportId, expectedVersion }): Promise<ReportView>` in the order of research R1: load the report, else `reportNotFound(reportId)` from `submit-report.ts`; load its worksite (plain `Error` when missing, as `SubmitReport`); `report.assertCanApprove(actor, worksite)`; when `expectedVersion !== report.version`, throw `versionConflict(expectedVersion, report.version)` from `save-draft.ts` (`// BR-15`); `report.approve(actor, worksite, this.clock.now())`; `toReportView(await this.reports.saveApproval(approved, expectedVersion))`.
- [X] T012 [US1] Create `test/unit/modules/reporting/application/approve-report.test.ts` with `InMemoryDailyReportRepository(reports, worksites)`, `InMemoryWorksiteRepository` and `FixedClock`:
  - Approves and returns version + 1 with the transition at `clock.now()` (US1-1).
  - `BR-9 sets every item's task to its reported progress and leaves other tasks unchanged` (US1-2, US1-3, FR-002).
  - Unknown report → `REPORT_NOT_FOUND` (US3-8).
  - `BR-15 rejects an approval with a stale version, with the current version, and writes nothing` (US4-2).
  - Order of checks (FR-020): a foreman with a stale version gets `REPORT_APPROVAL_FORBIDDEN`, not a conflict; the supervisor with a stale version on an `APPROVED` report gets `REPORT_VERSION_CONFLICT`, not `INVALID_STATUS_TRANSITION`.
  - A refused approval leaves the stored report and every task unchanged.

### Interface and wiring

- [X] T013 [US1] In `src/modules/reporting/interface/report.schemas.ts` add `approveReportBody = z.strictObject({ version: z.number().int().min(1) })` with a comment that any other field, including a reason or comment, is refused (research R6; Clarifications). In `report.routes.ts` add `approveReport: ApproveReport` to `ReportUseCases` and `POST /reports/:reportId/approve` through `withValidInput({ params: reportParams, body: approveReportBody }, …)`, calling `execute({ actor: currentActor(res), reportId: toReportId(params.reportId), expectedVersion: body.version })` and responding `200` with the `ReportView`.
- [X] T014 [US1] Export `ApproveReport` from `src/modules/reporting/index.ts`; add `approveReport: ApproveReport` to `AppDependencies` in `src/app.ts` and pass it to `reportRoutes`; create it in `src/main.ts` as `new ApproveReport(reports, worksites, clock)`; wire it the same way in `test/support/test-app.ts`.
- [X] T015 [US1] Create `test/api/approve-report.api.test.ts` (seeded example after truncation, as `report-flow.api.test.ts` does; Mark drafts walls at 55% for `2026-11-20` and submits). First tests:
  - `200`: `status` `APPROVED`, `version` increased by 1, last transition `SUBMITTED → APPROVED` by Linda with `occurredAt` ending in `Z` and `reason` null; then `GET /worksites/<townhouse>` as Linda shows walls 55, foundation 100, electrical 0 (US1-1, US1-2, SC-001).
  - `400 VALIDATION_FAILED` for a non-UUID report ID, a missing `version`, a `version` of 0, a body with `comment`, a query parameter, and a missing `Idempotency-Key` (US4-5, FR-015).
  - `401 UNAUTHENTICATED` with no actor headers; `404 REPORT_NOT_FOUND` for an unknown UUID (US3-8).
  - `GET /reports/<id>` as Mark and as Linda after approval shows `APPROVED`, the new version and both transitions oldest first (US1-7).

**Checkpoint**: `npm run check` and `npm run test:all` pass. Suggested commit: `feat(reporting): approve a daily report`.

---

## Phase 4: User Story 2 - Approval is all or nothing (Priority: P1)

**Goal**: an approval that finds any task already above the report changes nothing, and names every such task.

**Independent Test**: approve the 21st at 70%, then try the 19th at 56%: `422 REPORT_PROGRESS_OUTDATED` naming walls (reported 56, approved 70); the 19th still `SUBMITTED` at its version with no new transition; walls still 70.

- [X] T016 [US2] In `test/integration/daily-report.repository.int.test.ts`, `describe("saveApproval")`: `BR-9 an approval where one of two tasks is already higher rolls back: the report stays SUBMITTED and no task changes`. Prepare a submitted report with two items; raise one task's `approved_progress` above its item with a direct update; call `saveApproval` with an `APPROVED` report built from it; expect `REPORT_PROGRESS_OUTDATED` whose `details.tasks` names that task with both figures; then assert the report row (status, version), the transition count and **both** tasks' `approved_progress` and `updated_at` are unchanged (UC-3 acceptance; US2-3, US2-5; SC-002). Add a second case with both tasks raised: `details.tasks` lists both, in item order (FR-006).
- [X] T017 [US2] In the same file: `BR-5 reports approved out of date order: approving the 19th at 40% after the 20th at 60% fails` (two submitted reports by the same author on the same task; `saveApproval` the 20th, then the 19th; the second throws `REPORT_PROGRESS_OUTDATED` and the task stays 60) (US2-1, FR-007).
- [X] T018 [US2] In `test/api/approve-report.api.test.ts` add: Mark submits walls at 56% for `2026-11-19` and at 70% for `2026-11-21`; Linda approves the 21st (`200`), then the 19th → `422 REPORT_PROGRESS_OUTDATED` with `details.tasks` `[{ taskId: WALLS, taskName: "Build ground-floor walls", reportedProgress: 56, approvedProgress: 70 }]`; `GET /reports/<19th>` shows `SUBMITTED` at the same version with one transition; the townhouse shows walls 70 (US2-1, US2-3). Also: approving in date order (19th, then 21st) succeeds twice and ends at 70 (US2-2).

**Checkpoint**: `npm run test:all` passes. Suggested commit: `test(reporting): prove approval is all or nothing`.

---

## Phase 5: User Story 3 - Only the worksite's Site Supervisor approves, and only once (Priority: P1)

**Goal**: every refusal of UC-3's third acceptance criterion and BR-10 is proven over HTTP.

**Independent Test**: Mark, Henry and Sam each get `403` with one identical body; Linda on a draft gets the same body; after Linda approves, approving again, saving and submitting are each `409`.

- [X] T019 [US3] In `test/api/approve-report.api.test.ts` add, with Sam created by `insertUser(client, { role: "SITE_SUPERVISOR" })` and a second worksite by `insertWorksite(client, { supervisorId: sam.id })`:
  - `BR-12` Mark (the author), Henry and Sam each get `403 REPORT_APPROVAL_FORBIDDEN`; the report stays `SUBMITTED` at the same version (US3-1 to US3-3; SC-004).
  - Linda approving Mark's `DRAFT` gets a body deep-equal to Sam's (US3-6, FR-009).
  - `BR-15` Linda approving from an older version → `409 REPORT_VERSION_CONFLICT` with `details.currentVersion`; nothing changes (US4-2, FR-017).
  - `BR-10` after Linda approves: approving again from the current version → `409 INVALID_STATUS_TRANSITION` with `details.from` `APPROVED`; Mark saving from the current version → `409 REPORT_NOT_EDITABLE`; Mark submitting → `409 INVALID_STATUS_TRANSITION` (US3-4, US3-5).
  - A `REJECTED` report (prepared with `insertReport`, `insertReportItem`, `insertTransition`) → `409 INVALID_STATUS_TRANSITION` with `details.from` `REJECTED` (US3-7).
  - A worksite closed after submission (direct update to `CLOSED`) → `200`; a task reassigned to Henry after submission (direct update) → `200`, walls at 55, assignee still Henry (US1-5, US1-6, FR-008).
- [X] T020 [P] [US3] In `test/api/permissions.api.test.ts` add `BR-12 a foreman cannot approve a report` and `BR-12 a supervisor of another worksite cannot approve a report` (`403 REPORT_APPROVAL_FORBIDDEN`) (testing.md §5; UC-3 acceptance).

**Checkpoint**: `npm run test:all` passes. Suggested commit: `test(reporting): cover who may approve and approval finality`.

---

## Phase 6: User Story 4 - Retries and simultaneous decisions (Priority: P1)

**Goal**: retries approve once, and of two simultaneous decisions on one report exactly one wins.

**Independent Test**: two approvals of one report from one version: one `200`, one `409 REPORT_VERSION_CONFLICT`, one approval transition, walls 55. Repeating the winner with its key returns the same body.

- [X] T021 [US4] In `test/integration/daily-report.repository.int.test.ts`, `describe("saveApproval")`: `BR-15 two approvals of the same report started together: exactly one succeeds` (two `saveApproval` calls from the same version via `Promise.allSettled`: one fulfilled, one rejected with `REPORT_VERSION_CONFLICT`; exactly one `SUBMITTED → APPROVED` transition) (US4-1, FR-018, SC-003).
- [X] T022 [US4] In the same file: `BR-5 two reports sharing a task, at 50% and 60%, approved together never leave the task at 50%` (outcomes: the 60% report `APPROVED`; the 50% report `APPROVED` or rejected with `REPORT_PROGRESS_OUTDATED`; the task ends at 60) (US4-7, FR-011, SC-006); and `two reports sharing two tasks approved together do not deadlock` (each settles as approved or `REPORT_PROGRESS_OUTDATED`, never another error; both tasks end at the higher figure) (research R4, R9).
- [X] T023 [P] [US4] In `test/api/concurrency.api.test.ts` add `BR-15 two approvals of one report from the same version: one 200, one 409` asserting the loser's code is `REPORT_VERSION_CONFLICT`, never `INVALID_STATUS_TRANSITION`, and that `GET /reports/<id>` has exactly one approval transition (US4-1; Clarifications).
- [X] T024 [US4] In `test/api/approve-report.api.test.ts` add (BR-14):
  - `BR-14 five identical approvals with one key yield one approval and five identical responses`: send the same approval 5 times in sequence with key K; all 5 bodies deep-equal; one `SUBMITTED → APPROVED` transition; walls' `updated_at` unchanged after the first (US4-3, FR-016, SC-005).
  - `BR-14 the same key with another version is refused as already used` → `422 IDEMPOTENCY_KEY_REUSED`; nothing changes (US4-4).
  - `BR-14 a refused approval releases its key`: Linda approves Mark's `DRAFT` at version 1 with key K → `403`; Mark submits (version 2); Linda sends the same key and body again → `409 REPORT_VERSION_CONFLICT`, not a replayed `403` (US4-6).

**Checkpoint**: `npm run test:all` passes. Suggested commit: `test(reporting): prove approval under retries and concurrency`.

---

## Phase 7: User Story 5 - Walk through the approval by hand (Priority: P2)

**Goal**: the PRD example's row "Linda approves Mark's report" works automatically and by hand.

**Independent Test**: run `http/report-flow.http` against `docker compose up --build`; after Linda's approval the townhouse shows walls 55 and electrical 0.

- [X] T025 [US5] In `test/api/report-flow.api.test.ts` extend the PRD example test: after Mark's submission, Linda approves from the returned version; the report is `APPROVED` with two transitions; `GET /worksites/<townhouse>` as Linda shows walls 55, electrical 0, foundation 100 (FR-021; implementation plan step 3 exit criterion). Update the comment about features 003 and 004 to say 004 extends it next.
- [X] T026 [P] [US5] In `http/report-flow.http`, after 002's requests, add named requests using the same variables and `@reportId`: Linda approves Mark's report from version 3 with its own `Idempotency-Key`; Linda views the report (`APPROVED`, version 4); Linda views the townhouse (walls 55, electrical 0) (FR-021, SC-008).

**Checkpoint**: `npm run test:all` passes. Suggested commit: `feat(reporting): walk through Linda's approval`.

---

## Phase 8: Polish and cross-cutting concerns

- [X] T027 [P] In `docs/engineering/implementation-plan.md` step 3, as listed in plan.md "Documents updated": the `worksite/index.ts` row is already satisfied by feature 002 (research R7); the `reporting/infrastructure` row updates tasks in ascending task ID order (R4); the Tests rows: the BR-5 refusal lists every task, a `DRAFT` gets `403` identical to BR-12's, the concurrency loser always gets `409 REPORT_VERSION_CONFLICT`, a body with a comment gets `400`.
- [X] T028 Run `npm run check`, `npm run test:all` and `npm run test:cov` and report the actual output; `domain` and `application` stay at or above 90% lines and branches. Run `grep -rhoE "BR-(5|9|10|12|15)\b" test/unit/modules/reporting test/integration test/api | sort -u` and confirm all five rules appear in test names (TST-01).
- [X] T029 Run [quickstart.md](./quickstart.md) sections 2 to 7 against `docker compose up --build` and record any difference from the expected results (SC-008).

**Suggested commit**: `docs: describe the approval in the implementation plan`.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: T001 first; it gates everything. T002, T003 after T001, in parallel.
- **Foundational (Phase 2)**: after Setup. T004 → T005 → T006 → T007; T008 after T005 (and T003, T004).
- **US1 (Phase 3)**: after Foundational. Blocks US2 to US5: every later story exercises the endpoint and `saveApproval`.
- **US2, US3, US4 (Phases 4 to 6)**: after US1. Independent of each other, but T016, T017, T021, T022 share `daily-report.repository.int.test.ts` and T018, T019, T024 share `approve-report.api.test.ts`; run tasks on the same file in ID order.
- **US5 (Phase 7)**: after US1.
- **Polish (Phase 8)**: after all stories.

### Shared files edited in sequence

`daily-report.ts` (T004, T009), `daily-report.repository.ts` (T005), `prisma-daily-report.repository.ts` (T006), `daily-report.repository.int.test.ts` (T007, T016, T017, T021, T022), `approve-report.api.test.ts` (T015, T018, T019, T024), and `src/app.ts`, `src/main.ts`, `test/support/test-app.ts` (T014).

### Key task dependencies

- T001 → T002, T003
- T004 → T005 → T006 → T007
- T003, T005 → T008
- T008, T009 → T010 → T011 → T012
- T011 → T013 → T014 → T015
- T015 → T016 → T017 → T018
- T015 → T019, T020
- T015 → T021 → T022; T015 → T023, T024
- T015 → T025, T026
- all → T027 → T028 → T029

## Parallel Examples

```text
# Setup, once T001 passes
T002 Caller.approve           T003 fake worksite replace()
# After US1, the three proof phases on different files
T020 permissions.api          T023 concurrency.api       T026 report-flow.http
# Polish
T027 implementation-plan.md   (then T028, T029 in sequence)
```

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1 (including the 002 gate) and Phase 2.
2. Phase 3 (US1): Linda can approve; BR-12, BR-10 and BR-5 are enforced from the first commit.
3. Stop and validate: `npm run test:all`, then approve Mark's report by hand.

### Incremental delivery

1. US1: approval with every guard.
2. US2: the rollback and out-of-date-order guarantees, proven against PostgreSQL.
3. US3: every refusal over HTTP.
4. US4: retries and races.
5. US5: the walkthrough; the PRD row "Linda approves Mark's report".
6. Polish: documents, full checks, quickstart.

Each phase ends with a commit whose build and tests pass (GIT-02).

## Plan test-row coverage

| Plan test plan row | Task |
| --- | --- |
| Unit: BR-12 foreman, other supervisor | T010 |
| Unit: `DRAFT` identical to BR-12 | T010 |
| Unit: BR-10 approve, edit, submit an `APPROVED` report | T010 |
| Unit: `REJECTED` refused | T010 |
| Unit: BR-5 one task; every task; equal accepted | T010 |
| Unit: BR-11 transition; items unchanged | T010 |
| Unit: closed worksite, reassigned task accepted | T010 |
| Unit: `ApproveReport` not found; order of checks; BR-15 stale; BR-9 tasks set | T012 |
| Integration: BR-9 happy path; a task at its current value is not written | T007 |
| Integration: BR-9 rollback, both tasks unchanged | T016 |
| Integration: BR-15 two approvals of one report | T021 |
| Integration: BR-5 out of date order | T017 |
| Integration: BR-5 shared task 50/60; no deadlock | T022 |
| API: `200`, worksite values | T015 |
| API: `400`, `401`, `404` | T015 |
| API: `403` cases | T019, T020 |
| API: `409` stale, `APPROVED`, `REJECTED`; `422` outdated | T019; T018 |
| API: closed worksite, reassigned task | T019 |
| API: BR-14 replay, reuse, release | T024 |
| API: concurrency | T023 |
| API: permissions | T020 |
| API: report flow | T025 |
| Manual: quickstart, `report-flow.http` | T026, T029 |
