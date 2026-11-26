---
description: "Task list for 004-reject-and-resubmit"
---

# Tasks: Reject and resubmit a daily report

**Input**: Design documents from `specs/004-reject-and-resubmit/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: required. Constitution principle VII and testing.md §1.1 require unit tests for domain
and use cases, integration tests for a migration and a repository, and API tests for the endpoint.
Every row of the plan's test plan maps to a task below (see "Plan test-row coverage"). A test for a
business rule starts its name with the rule ID (TST-01), for example
`it("BR-8 rejects a rejection with a blank reason")`.

**Organization**: the migration is foundational: it guards every rejection the stories write. The
reject method and the endpoint are then built completely in US1, including the BR-12, BR-10 and
BR-8 checks, so no commit exposes a rejection without its guards. US2 proves editing and
resubmitting, which need no production code (research R7). US3 and US4 prove permissions, retries
and races over HTTP and against PostgreSQL. US5 and US6 run the whole PRD example, automated and by
hand. Within a story: domain and its unit tests, then the use case and its unit tests, then the
repository and its integration tests, then the route and its API tests.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story from spec.md (US1 to US6)

## Conventions for every task

- Read `AGENTS.md` and the files the task names before editing. Use glossary terms exactly.
- Production code under `src/` uses relative imports; tests import it as `@src/...` (TST-13).
- Every business rule in code cites its ID in a comment: `// BR-8` (DOC-02).
- Errors are `DomainError` subclasses from `src/shared/domain/errors.ts` with the codes and
  messages in [contracts/reject-report.md](./contracts/reject-report.md). `error-handler.ts` does
  not change.
- After each task that changes code, `npm run check` passes. Report the actual output.
- Integration and API tests need Docker: `npm run test:int`, `npm run test:api`.
- API tests send `X-Actor-Id`, `X-Actor-Role` and a fresh `Idempotency-Key` on every `POST` and
  `PUT`, through the `Caller` helper in `test/support/townhouse.ts`.
- Concurrency tests use `Promise.allSettled` and assert on the set of outcomes (research R10).
- Sam (another Site Supervisor) and his worksite are created with `insertUser(client, { role: "SITE_SUPERVISOR" })` and `insertWorksite(client, { supervisorId: sam.id })` from `test/support/database.ts`, as in `test/api/approve-report.api.test.ts`.
- Do not edit `tsconfig.json`, `biome.json`, `.dependency-cruiser.cjs`, the CI workflow, any
  committed migration, `schema.prisma`, `docs/product/` or `docs/adr/`. Do not add ignore comments.
- Keep the `reporting` file layout: no new files in `reporting/domain`; no change to
  `reporting/infrastructure`, `src/modules/worksite/` or the fakes (plan, Project Structure).

---

## Phase 1: Setup (starting point and test helper)

**Purpose**: confirm the starting point, and add the test helper every story uses.

- [X] T001 Confirm the starting point (research R12): `git log` contains `fdd369a` (feature 003's last commit); `git status --short` shows only `specs/004-reject-and-resubmit/`; `npm run check` and `npm run test:all` pass on `main`. If any fails, stop and ask; do not start T002.
- [X] T002 [P] In `test/support/townhouse.ts` add `Caller.reject(reportId: string, body: unknown, key: string = randomUUID()): request.Test`, sending `POST /reports/${reportId}/reject` with `Idempotency-Key`, the same way as `Caller.approve`.

---

## Phase 2: Foundational (the database guards the reason)

**Purpose**: the two `CHECK` constraints every rejection is written under (research R5; data-model.md §2.2).

- [X] T003 Create the migration: run `npx prisma migrate dev --create-only --name add_transition_reason_checks` (`schema.prisma` is unchanged, so the generated `migration.sql` is empty), then write into `prisma/migrations/<timestamp>_add_transition_reason_checks/migration.sql` exactly:
  ```sql
  -- FR-003: a transition's reason is at most 2,000 characters, as notes are.
  ALTER TABLE "report_transitions" ADD CONSTRAINT "report_transitions_reason_length"
    CHECK (char_length("reason") <= 2000);
  -- BR-8: a rejection has a reason with at least one non-space character.
  ALTER TABLE "report_transitions" ADD CONSTRAINT "report_transitions_rejection_reason"
    CHECK ("to_status" <> 'REJECTED' OR ("reason" IS NOT NULL AND "reason" ~ '\S'));
  ```
  Apply it with `npx prisma migrate dev` and confirm `prisma migrate status` reports no drift. Do not edit either existing migration.
- [X] T004 In `test/integration/reporting-schema.int.test.ts` add `describe("report_transitions")` cases using `insertReport` and `insertTransition` from `test/support/database.ts`:
  - `BR-8 rejects a REJECTED transition with a NULL, empty or whitespace-only reason` (`null`, `""`, `" \t\n "`), each failing with `/report_transitions_rejection_reason/`.
  - `BR-8 accepts a REJECTED transition with a reason, and a SUBMITTED transition with none`.
  - `rejects a reason of 2,001 characters and accepts 2,000` (`/report_transitions_reason_length/`) (FR-003; SC-005).

**Checkpoint**: `npm run check` and `npm run test:int` pass. Suggested commit: `feat(reporting): guard rejection reasons in the database`.

---

## Phase 3: User Story 1 - Reject a submitted report with a reason (Priority: P1) 🎯 MVP

**Goal**: `POST /reports/:reportId/reject` moves a `SUBMITTED` report to `REJECTED` and records the transition with its reason, guarded by BR-12, BR-10 and BR-8; no task changes ([contracts/reject-report.md](./contracts/reject-report.md)).

**Independent Test**: as Linda, reject Henry's submitted report (electrical at 10%) with its current version and "conduit laid, no wiring pulled yet": `REJECTED`, version + 1, one more transition `SUBMITTED → REJECTED` by Linda with that reason; the townhouse still shows electrical 0.

### Domain

- [X] T005 [US1] In `src/modules/reporting/domain/daily-report.ts`, in `DailyReport` (data-model.md §1.1, §1.2; research R2, R3):
  - Add `private assertDecidableBy(actor: Actor, worksite: ReportWorksite, refusal: () => ForbiddenError): void` (`// BR-12`, and `// a DRAFT gets BR-12's answer: the supervisor may not see drafts (FR-030)`): allowed only when `actor.role === Role.SITE_SUPERVISOR`, `actor.id === worksite.supervisorId` and `this.status !== ReportStatus.DRAFT`; otherwise `throw refusal()`.
  - Change `assertCanApprove` to call `this.assertDecidableBy(actor, worksite, () => new ForbiddenError("REPORT_APPROVAL_FORBIDDEN", …unchanged message…, { reportId: this.id }))`. Behavior, code and message must not change; the existing 003 tests are the proof.
  - Add `assertCanReject(actor: Actor, worksite: ReportWorksite): void` calling `assertDecidableBy` with `new ForbiddenError("REPORT_REJECTION_FORBIDDEN", "You may not reject this report. Only the site supervisor of its worksite may reject it, once it is submitted.", { reportId: this.id })`.
  - Add `reject(actor: Actor, worksite: ReportWorksite, reason: string | null, at: Date): DailyReport`, in this order: `this.assertCanReject(actor, worksite)`; `assertTransition(this.status, ReportStatus.REJECTED)` (`// BR-10: an APPROVED report is final`); `if (reason === null || reason.trim() === "")` throw `new RuleViolationError("REJECTION_REASON_REQUIRED", "A reason is required to reject a report. Say what its author needs to change.")` (`// BR-8`); return `this.with({ status: ReportStatus.REJECTED, transitions: [...this.transitions, { from: this.status, to: ReportStatus.REJECTED, actorId: actor.id, occurredAt: at, reason }] })` (`// BR-11`), with `reason` exactly as given, not trimmed. Do not read `worksite.tasks`, the worksite's status or approved progress (`// FR-007: BR-3, BR-4 and BR-5 do not apply to rejection`).
- [X] T006 [US1] In `test/unit/modules/reporting/domain/daily-report.test.ts` add `describe("reject")`, using the existing builders (`aReport()` and friends from `test/support/daily-report.builder.ts` and `test/support/worksite.builder.ts`):
  - `BR-11 rejecting records one transition SUBMITTED to REJECTED with the supervisor, the time and the reason`; items and note unchanged (US1-1; FR-004, FR-006).
  - `BR-11 the reason is stored exactly as given`: `"  conduit laid  "` keeps its spaces (Clarifications Q4).
  - `BR-8 rejects a rejection without a reason` for `null`, `""`, `"   "` and `"\t\n"`: `REJECTION_REASON_REQUIRED` (US1-3; FR-002).
  - `BR-12 rejects rejection by a foreman, including the author` and `BR-12 rejects rejection by a supervisor of another worksite`: `REPORT_REJECTION_FORBIDDEN`, `details` `{ reportId }` (US3-1 to US3-3; FR-009).
  - `rejects rejection of a DRAFT with exactly the BR-12 refusal`: same `code`, `message` and `details` as the other-supervisor case (US3-6; FR-008).
  - `BR-10 an APPROVED report cannot be rejected`: `INVALID_STATUS_TRANSITION`, `details` `{ from: "APPROVED", to: "REJECTED" }` (US3-4).
  - A `REJECTED` report cannot be rejected again: `INVALID_STATUS_TRANSITION`, `from` `REJECTED` (US3-5).
  - `BR-8 the reason is checked last`: a foreman with no reason gets `REPORT_REJECTION_FORBIDDEN`; an `APPROVED` report with no reason gets `INVALID_STATUS_TRANSITION` (US3-8; FR-021).
  - Accepts a report on a `CLOSED` worksite, one whose task is now assigned to another foreman, and one whose task's approved progress is above its reported progress (US1-4 to US1-6; FR-007).

### Application

- [X] T007 [US1] Create `src/modules/reporting/application/reject-report.ts`: `export interface RejectReportInput { readonly actor: Actor; readonly reportId: ReportId; readonly expectedVersion: number; readonly reason: string | null }` and class `RejectReport`, constructor `(reports: DailyReportRepository, worksites: WorksiteRepository, clock: Clock)`, `execute(input): Promise<ReportView>` in the order of research R1, mirroring `approve-report.ts`: load the report, else `throw reportNotFound(input.reportId)` (from `get-report.ts`); load its worksite (plain `Error` when missing); `report.assertCanReject(input.actor, worksite)`; when `report.version !== input.expectedVersion`, `throw versionConflict(input.expectedVersion, report.version)` (from `save-draft.ts`, `// BR-15`); `const rejected = report.reject(input.actor, worksite, input.reason, this.clock.now())`; `return toReportView(await this.reports.save(rejected, input.expectedVersion))` (research R4: the existing conditional write). Class comment: UC-4, order existence, permission, version, status, reason.
- [X] T008 [US1] Create `test/unit/modules/reporting/application/reject-report.test.ts` with `InMemoryDailyReportRepository`, `InMemoryWorksiteRepository` and `FixedClock`, set up as `approve-report.test.ts`:
  - Rejects and returns version + 1, `REJECTED`, the transition at `clock.now()` with the reason (US1-1).
  - Changes no task: the worksite's tasks are deep-equal before and after (FR-006, FR-015).
  - Unknown report → `REPORT_NOT_FOUND` (US3-7; FR-010).
  - `BR-15 rejects a rejection with a stale version, with the current version, and writes nothing` (US4-4; FR-018).
  - Order of checks (FR-021): a foreman with a stale version gets `REPORT_REJECTION_FORBIDDEN`; the supervisor with a stale version on an `APPROVED` report gets `REPORT_VERSION_CONFLICT`; the supervisor with the current version, an `APPROVED` report and no reason gets `INVALID_STATUS_TRANSITION`.
  - A refused rejection (`BR-8`, no reason) leaves the stored report unchanged.

### Repository

- [X] T009 [US1] In `test/integration/daily-report.repository.int.test.ts` add `describe("save, rejecting")`: `BR-11 saving a rejected report stores the transition with its reason`: insert a submitted report with one item; load it; build the rejection with `report.reject(...)` for its worksite's supervisor; `save` it; assert the `daily_reports` row (`REJECTED`, version + 1), one new `report_transitions` row with `to_status` `REJECTED` and the reason, and the item's `updated_at` unchanged (FR-004 to FR-006; research R4). No production change is expected; if one is needed, stop and ask.

### Interface and wiring

- [X] T010 [US1] In `src/modules/reporting/interface/report.schemas.ts` add `const REASON_MAX_LENGTH = 2000;` with the comment `/** The longest rejection reason: the note limit (spec Clarifications Q1). The database guards it too. */`, and `export const rejectReportBody = z.strictObject({ version: z.number().int().min(1), reason: z.string().max(REASON_MAX_LENGTH, \`The reason must be at most ${REASON_MAX_LENGTH} characters.\`).nullable().optional() })`, with a comment that a missing or `null` reason is BR-8, decided in the domain (Clarifications Q2; research R6). In `report.routes.ts` add `rejectReport: RejectReport` to `ReportUseCases` and `POST /reports/:reportId/reject` through `withValidInput({ params: reportParams, body: rejectReportBody }, …)`, calling `execute({ actor: currentActor(res), reportId: toReportId(params.reportId), expectedVersion: body.version, reason: body.reason ?? null })` and responding `200` with the `ReportView`.
- [X] T011 [US1] Export `RejectReport` from `src/modules/reporting/index.ts`; add `rejectReport: RejectReport` to `AppDependencies` in `src/app.ts` and pass it to `reportRoutes`; create it in `src/main.ts` as `new RejectReport(reports, worksites, clock)`; wire it the same way in `test/support/test-app.ts`.
- [X] T012 [US1] Create `test/api/reject-report.api.test.ts` (seeded example after truncation, as `approve-report.api.test.ts` does; Henry drafts Install electrical at 10% for `2026-11-20` and submits). First tests:
  - `200`: `status` `REJECTED`, `version` increased by 1, last transition `SUBMITTED → REJECTED` by Linda with `occurredAt` ending in `Z` and `reason` `"conduit laid, no wiring pulled yet"`; then `GET /worksites/<townhouse>` as Linda shows foundation 100, walls 40, electrical 0 (US1-1, US1-2).
  - `GET /reports/<id>` as Henry and as Linda shows `REJECTED`, the new version and both transitions oldest first, the second with the reason (US1-7; FR-011).
  - `400 VALIDATION_FAILED` for a non-UUID report ID, a missing `version`, a `version` of 0, a numeric `reason`, a `reason` of 2,001 characters, an unknown field (`comment`), a query parameter, and a missing `Idempotency-Key`; a `reason` of exactly 2,000 characters gets `200` (US4-8; FR-003, FR-016).
  - `BR-8 422 REJECTION_REASON_REQUIRED` for a missing, `null`, empty and blank (`"   "`) reason; the report stays `SUBMITTED` at the same version (US1-3; FR-002; SC-005).
  - `401 UNAUTHENTICATED` with no actor headers; `404 REPORT_NOT_FOUND` for an unknown UUID (US3-7).
  - `200` for a worksite closed after submission (direct update to `CLOSED`), for a task reassigned to Mark after submission (direct update), and for a report whose approval is refused with `422 REPORT_PROGRESS_OUTDATED` (Henry's 10% after electrical's `approved_progress` is set to 20 by a direct update) (US1-4 to US1-6; FR-007).

**Checkpoint**: `npm run check` and `npm run test:all` pass. Suggested commit: `feat(reporting): reject a daily report with a reason`.

---

## Phase 4: User Story 2 - The Foreman sees the reason, edits and resubmits (Priority: P1)

**Goal**: after a rejection, the author reads the reason, edits the report while it stays `REJECTED`, and resubmits it; the history keeps every rejection, and no task changes until approval. No production code (research R7).

**Independent Test**: Linda rejects Henry's report; Henry views it and reads the reason, saves electrical at 5% (`REJECTED`, version 4) and submits (`SUBMITTED`, version 5, three transitions); electrical is 0 after every step.

- [X] T013 [P] [US2] In `test/unit/modules/reporting/domain/daily-report.test.ts` add, using `aReport().rejected()` from `test/support/daily-report.builder.ts`:
  - `BR-6 the author can edit a REJECTED report, which stays REJECTED` (US2-2; FR-012).
  - `BR-6 another foreman cannot edit a REJECTED report` (`NOT_REPORT_AUTHOR`) and a site supervisor cannot (`ROLE_CANNOT_AUTHOR_REPORTS`) (US2-5).
  - `BR-6 the author can submit a REJECTED report, edited or not, recording REJECTED to SUBMITTED after the rejection`, the rejection transition and its reason unchanged (US2-3, US2-4; FR-013, FR-014).
  If any of these fails, stop and report: research R7 says feature 002 already allows them.
- [X] T014 [US2] In `test/api/reject-report.api.test.ts` add `describe("after a rejection")`. A `beforeEach` has Henry draft electrical at 10% (version 1) and submit (version 2), and Linda reject it with "conduit laid, no wiring pulled yet" (version 3). Each bullet is its own `it`, starting from that freshly rejected report at version 3:
  - Henry's `GET /reports/<id>` shows the rejection transition with Linda as actor and the reason (US2-1).
  - `BR-6` Henry saves electrical at 5% from version 3: `200`, `REJECTED`, version 4, and the response's `transitions` include the reason (US2-2; FR-011; SC-006).
  - Henry saves at 5% (version 4), then submits from version 4: `200`, `SUBMITTED`, version 5, transitions `DRAFT→SUBMITTED`, `SUBMITTED→REJECTED` (reason unchanged), `REJECTED→SUBMITTED` by Henry (US2-3; FR-013, FR-014).
  - Henry resubmits without editing, from version 3: `200`, `SUBMITTED`, version 4 (US2-4).
  - `BR-15` Henry saves at 5% (version 4), then submits from version 3, the version he read before his own edit: `409 REPORT_VERSION_CONFLICT` with `details.currentVersion` 4; the report stays `REJECTED` (US4-5).
  - UC-4 acceptance: after the rejection, the save and the resubmission, `GET /worksites/<townhouse>` shows electrical 0 each time; after Linda approves from version 5, electrical 5 and the report has four transitions (US2-6, US2-7; FR-015; SC-002).
  - Rejected twice: Henry resubmits from version 3, then Linda rejects again with "wiring incomplete"; both rejections and their reasons are in the history, oldest first (US2-8; FR-014).
  - `BR-4` after Install electrical is reassigned to Mark (direct update of `tasks.assignee_id`): Henry saving electrical at 5% and Henry resubmitting from version 3 each get `422 TASK_NOT_ASSIGNED_TO_AUTHOR` naming the task; the report stays `REJECTED` at version 3 (spec Edge Cases; FR-012, FR-013).
  - `BR-5` after electrical's `approved_progress` is set to 20 (direct update): Henry resubmitting from version 3 gets `422 PROGRESS_BELOW_APPROVED` naming electrical with approved progress 20; Henry then saves electrical at 20 (version 4) and resubmits: `200`, `SUBMITTED` (spec Edge Cases; FR-013).
  - `BR-7` Henry saves with `items: []` from version 3: `200`, `REJECTED`, version 4; resubmitting from version 4 gets `422 REPORT_HAS_NO_ITEMS` (spec Edge Cases; FR-012, FR-013).
  - `BR-3` after the townhouse is closed (direct update of `worksites.status` to `CLOSED`): Henry saving and Henry resubmitting from version 3 each get `422 WORKSITE_CLOSED`; the report stays `REJECTED` at version 3. This is the behavior open product question P6 asks about (spec Edge Cases, Clarifications Q3).
- [X] T015 [P] [US2] In `test/api/permissions.api.test.ts` add `BR-6 a foreman cannot edit or submit another foreman's rejected report` (Mark on Henry's rejected report: `403 NOT_REPORT_AUTHOR` for both) and `a site supervisor cannot edit or submit a rejected report` (Linda: `403 ROLE_CANNOT_AUTHOR_REPORTS`); the report stays `REJECTED` at the same version (US2-5).

**Checkpoint**: `npm run test:all` passes. Suggested commit: `test(reporting): prove editing and resubmitting a rejected report`.

---

## Phase 5: User Story 3 - Only the worksite's Site Supervisor rejects, and only a submitted report (Priority: P1)

**Goal**: every refusal of BR-12, BR-10 and the lifecycle for rejection is proven over HTTP.

**Independent Test**: Henry, Mark and Sam each get `403` with one identical body; Linda on a draft gets the same body; rejecting an `APPROVED` or a `REJECTED` report is `409`.

- [X] T016 [US3] In `test/api/reject-report.api.test.ts` add:
  - `BR-12` Henry (the author), Mark and Sam each get `403 REPORT_REJECTION_FORBIDDEN` with `details.reportId`; the report stays `SUBMITTED` at the same version (US3-1 to US3-3; SC-004).
  - Linda rejecting Henry's `DRAFT` gets a body deep-equal to Sam's (US3-6; FR-008).
  - Henry, Mark and Sam with no reason still get `403`, not `422` (US3-8; FR-021).
  - `BR-10` Linda rejecting Mark's report after approving it, from its current version → `409 INVALID_STATUS_TRANSITION` with `details` `{ from: "APPROVED", to: "REJECTED" }`; walls stays 55 (US3-4).
  - Linda rejecting Henry's `REJECTED` report from its current version → `409 INVALID_STATUS_TRANSITION`, `from` `REJECTED` (US3-5).
  - `BR-15` Linda rejecting from an older version → `409 REPORT_VERSION_CONFLICT` with `details.currentVersion`; nothing changes (US4-4; FR-018).
- [X] T017 [P] [US3] In `test/api/permissions.api.test.ts` add `BR-12 a foreman cannot reject a report` and `BR-12 a supervisor of another worksite cannot reject a report` (`403 REPORT_REJECTION_FORBIDDEN`) (testing.md §5; implementation plan step 4).

**Checkpoint**: `npm run test:all` passes. Suggested commit: `test(reporting): cover who may reject a report`.

---

## Phase 6: User Story 4 - Simultaneous decisions and retries (Priority: P1)

**Goal**: of an approval and a rejection started together exactly one wins and the other changes nothing; retries reject once.

**Independent Test**: approve and reject Henry's report from one version at once: one `200`, one `409 REPORT_VERSION_CONFLICT`, one new transition, electrical 10 if the approval won and 0 if the rejection won.

- [X] T018 [US4] In `test/integration/daily-report.repository.int.test.ts` add `BR-15 approve and reject started together: exactly one succeeds`: insert a submitted report with one item on a task at 0, reported 10; load it twice; build an approved copy with `approve(...)` and a rejected copy with `reject(...)`; run `saveApproval(approved, v)` and `save(rejected, v)` with `Promise.allSettled`. Assert: exactly one fulfilled, the other rejected with code `REPORT_VERSION_CONFLICT`; exactly one new transition; if the approval won, status `APPROVED` and the task at 10; if the rejection won, status `REJECTED` and the task at 0 with `updated_at` unchanged (US4-1, US4-2; FR-019; SC-003; research R4, R10).
- [X] T019 [P] [US4] In `test/api/concurrency.api.test.ts` add:
  - `BR-15 approve and reject of one report from the same version: one 200, one 409`: Henry's submitted report; `linda.approve` and `linda.reject` together via `Promise.allSettled`; one `200`; the other `409` with code `REPORT_VERSION_CONFLICT`, never `INVALID_STATUS_TRANSITION`; `GET /reports/<id>` has exactly two transitions; electrical is 10 if the `200` was the approval, else 0 (US4-1, US4-2; UC-3 acceptance).
  - `BR-15 two rejections of one report from the same version: one 200, one 409` with one rejection transition (US4-3).
- [X] T020 [US4] In `test/api/reject-report.api.test.ts` add (BR-14):
  - `BR-14 five identical rejections with one key yield one rejection and five identical responses` (in sequence, key K; all bodies deep-equal; one `SUBMITTED → REJECTED` transition) (US4-6; FR-017; SC-007).
  - `BR-14 the same key with another reason is refused as already used` → `422 IDEMPOTENCY_KEY_REUSED`; nothing changes (US4-7).
  - `BR-14 a refused rejection releases its key`: Linda rejects with key K and no reason → `422 REJECTION_REASON_REQUIRED`; she then sends key K with the same version and a reason → `200`, `REJECTED`, not `422 IDEMPOTENCY_KEY_REUSED`. A different body is accepted only because the refused request was not recorded against K (002 FR-026).

**Checkpoint**: `npm run test:all` passes. Suggested commit: `test(reporting): prove rejection under retries and races`.

---

## Phase 7: User Story 5 - The whole PRD example runs end to end (Priority: P1)

**Goal**: the PRD's townhouse example passes as one API test, row by row.

**Independent Test**: from the example data, run the example's steps in order; both tasks' approved progress matches the PRD table after each row.

- [X] T021 [US5] In `test/api/report-flow.api.test.ts` add a `henry` `Caller` (`HENRY`, `FOREMAN`) and two tests; keep the two existing tests:
  - `the PRD example, row by row`: Mark submits walls at 55% and Henry submits electrical at 10% for `2026-11-20` → walls 40, electrical 0; Linda approves Mark's report → 55, 0; Linda rejects Henry's report with `"conduit laid, no wiring pulled yet"` → 55, 0; Henry saves electrical at 5% and resubmits → 55, 0; Linda approves → 55, 5. Assert both tasks after every row via `GET /worksites/<townhouse>` as Linda, and that Henry's report ends `APPROVED` at version 6 with four transitions (US5-1 to US5-4; FR-022; SC-001, SC-002).
  - `from the end of the example, Mark cannot report walls below 55% or report electrical for 21 November`: after the same steps, Mark saving walls at 50% for `2026-11-21` then submitting → `422 PROGRESS_BELOW_APPROVED`; Mark saving electrical → `422 TASK_NOT_ASSIGNED_TO_AUTHOR` (US5-5). Set the `FixedClock` so 21 November is within the backdating limit (it is with `TEST_NOW`).
  Update the file's doc comment: features 002 to 004 cover the whole example.

**Checkpoint**: `npm run test:all` passes. Suggested commit: `test: run the whole PRD example end to end`.

---

## Phase 8: User Story 6 - Walk through the whole example by hand (Priority: P2)

**Goal**: `http/report-flow.http` runs the whole PRD example in the PRD's order, and README "Run it" says so (research R8).

**Independent Test**: from a clean stack, run the file top to bottom; the townhouse views show 40/0 after both submissions, 55/0, 55/0 after the rejection, 55/5.

- [X] T022 [US6] In `http/report-flow.http` (research R8; data-model.md §5):
  - Header comment: replace "Feature requests (draft, submit, reject, approve) are added here as each feature lands." with a sentence that the file runs the whole PRD example, row by row.
  - After Mark's submission and before Linda views the submitted report, add `@electrical = 00000000-0000-4000-8000-000000000203` and: Henry drafts Install electrical at 10% (`# @name henryDraft`, key `walkthrough-004-henry-draft`); `@henryReportId = {{henryDraft.response.body.$.id}}`; Henry submits from version 1 (key `walkthrough-004-henry-submit`). Change the following townhouse view's comment to PRD row 1: both reports submitted, walls 40, electrical 0.
  - Keep feature 003's approval block (row 2: 55, 0).
  - Append a `# Feature 004` block: Linda rejects Henry's report from version 2 with `"reason": "conduit laid, no wiring pulled yet"` (key `walkthrough-004-reject`; expected `REJECTED`, version 3); Linda views the townhouse (row 3: 55, 0); Henry views his report (the reason in the last transition); Henry saves electrical at 5% from version 3 (key `walkthrough-004-henry-edit`; `REJECTED`, version 4); Henry submits from version 4 (key `walkthrough-004-henry-resubmit`; `SUBMITTED`, version 5); Linda approves from version 5 (key `walkthrough-004-approve-henry`; `APPROVED`, version 6); Linda views the townhouse (row 4: 55, 5); Linda views Henry's report (four transitions).
  Each request's comment states the expected status and version, as the existing requests do.
- [X] T023 [P] [US6] In `README.md` "Run it", replace "Reports are not part of the example data, and the walkthrough creates Mark's report for 20 November." with a sentence that the walkthrough creates Mark's and Henry's reports for 20 November and runs the whole PRD example: both submit, Linda approves Mark's, rejects Henry's with a reason, Henry corrects and resubmits, Linda approves (FR-025). Keep the `docker compose down -v` sentence.

**Checkpoint**: Suggested commit: `docs: walk through the whole PRD example`.

---

## Phase 9: Polish and cross-cutting concerns

- [X] T024 [P] In `docs/engineering/implementation-plan.md` step 4, as listed in plan.md "Documents updated": add a `reporting/infrastructure` row (no new repository method, rejection uses `save`, research R4; a migration adds the two `CHECK`s on `report_transitions`, R5); in Tests, `BR-8` refuses a missing, empty or blank reason after permission, version and status; `BR-12` and a `DRAFT` get `403 REPORT_REJECTION_FORBIDDEN`; an Integration row for the two `CHECK`s; an API row: approve against reject, the loser always `409 REPORT_VERSION_CONFLICT`; a reason over 2,000 characters is a `400`. Under "Questions to settle", mark both answered: at most 2,000 characters; the reason is in every response that returns the report. Do not change P6.
- [X] T025 Run `npm run check`, `npm run test:all` and `npm run test:cov` and report the actual output; `domain` and `application` stay at or above 90% lines and branches. Run `grep -rhoE "BR-(6|8|10|11|12|15)\b" test/unit/modules/reporting test/integration test/api | sort -u` and confirm all six appear (TST-01). Confirm each PRD implementation goal has a passing test, as mapped in research R9 (FR-023; SC-008).
- [ ] T026 Run [quickstart.md](./quickstart.md) sections 2 to 7 against `docker compose down -v && docker compose up --build`, including `http/report-flow.http` top to bottom, and record any difference from the expected results (FR-024; SC-009).

**Suggested commit**: `docs: describe rejection in the implementation plan`.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: T001 first; it gates everything. T002 after T001.
- **Foundational (Phase 2)**: after T001. T003 → T004.
- **US1 (Phase 3)**: after Foundational and T002. Blocks US2 to US6: every later story calls the endpoint.
- **US2, US3, US4 (Phases 4 to 6)**: after US1. Independent of each other, but T014, T016, T020 share `reject-report.api.test.ts`, T015 and T017 share `permissions.api.test.ts`, and T009 and T018 share `daily-report.repository.int.test.ts`; run tasks on the same file in ID order.
- **US5 (Phase 7)**: after US1 (uses rejection, save, submit and approve).
- **US6 (Phase 8)**: after US1; best after US5, which proves the same sequence automatically.
- **Polish (Phase 9)**: after all stories.

### Shared files edited in sequence

`daily-report.ts` (T005), `daily-report.test.ts` (T006, T013), `daily-report.repository.int.test.ts` (T009, T018), `reject-report.api.test.ts` (T012, T014, T016, T020), `permissions.api.test.ts` (T015, T017), and `src/app.ts`, `src/main.ts`, `test/support/test-app.ts` (T011).

### Key task dependencies

- T001 → T002, T003
- T003 → T004
- T004, T005 → T006 → T007 → T008 → T009
- T009 → T010 → T011 → T012
- T012 → T013, T014, T015
- T012 → T016, T017
- T012 → T018, T019, T020
- T012 → T021 → T022, T023
- all → T024 → T025 → T026

## Parallel Examples

```text
# After US1, different files
T013 daily-report.test.ts (BR-6)   T015 permissions.api (rejected report)   T019 concurrency.api
# Walkthrough
T022 report-flow.http              T023 README.md
# Polish
T024 implementation-plan.md        (then T025, T026 in sequence)
```

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1 and Phase 2: the starting point and the database guard.
2. Phase 3 (US1): Linda can reject with a reason; BR-12, BR-10 and BR-8 are enforced from the first commit.
3. Stop and validate: `npm run test:all`, then reject Henry's report by hand.

### Incremental delivery

1. US1: rejection with every guard.
2. US2: the Foreman reads the reason, edits and resubmits; no task changes until approval.
3. US3: every refusal over HTTP.
4. US4: retries and the approve-against-reject race.
5. US5: the PRD example as one test.
6. US6: the walkthrough and README.
7. Polish: documents, full checks, quickstart.

Each phase ends with a commit whose build and tests pass (GIT-02).

## Plan test-row coverage

| Plan test plan row | Task |
| --- | --- |
| Unit: BR-12 foreman, other supervisor | T006 |
| Unit: `DRAFT` identical to BR-12 | T006 |
| Unit: `assertCanApprove` unchanged after refactor | T005 (existing 003 tests) |
| Unit: BR-10 `APPROVED`; `REJECTED` refused | T006 |
| Unit: BR-8 null, empty, spaces, tabs and newlines | T006 |
| Unit: BR-8 checked after permission and status | T006 |
| Unit: BR-11 transition, reason as given; items unchanged | T006 |
| Unit: closed worksite, reassigned task, outdated progress accepted | T006 |
| Unit: BR-6 edit a `REJECTED` report; others cannot | T013 |
| Unit: BR-6 submit a `REJECTED` report, edited or not | T013 |
| Unit: `RejectReport` not found; order of checks; BR-15 stale; no task changed | T008 |
| Integration: BR-11 rejection stored with reason, items untouched | T009 |
| Integration: BR-15 save (reject) against saveApproval | T018 |
| Integration: BR-8 and length `CHECK`s | T004 |
| API: `200`, townhouse unchanged | T012 |
| API: `400` cases, 2,000 accepted; `401` | T012 |
| API: `422 REJECTION_REASON_REQUIRED` | T012 |
| API: `403` cases, `DRAFT`; `404` | T016; T012 |
| API: `409` stale, `APPROVED`, `REJECTED` | T016 |
| API: closed worksite, reassigned task, outdated report | T012 |
| API: BR-14 replay, reuse, release | T020 |
| API: BR-6 save and resubmit after rejection, reason in responses | T014 |
| API: FR-012, FR-013 checks on a `REJECTED` report (BR-4, BR-5, BR-7, BR-15 stale resubmit) | T014 |
| API: closed worksite after rejection, P6 behavior (BR-3) | T014 |
| API: rejected twice | T014 |
| API: concurrency approve against reject; two rejections | T019 |
| API: permissions reject; rejected report not editable by others | T017; T015 |
| API: PRD example row by row | T021 |
| API: 21 November refusals | T021 |
| API: implementation goals mapped | T025 |
| Manual: quickstart, `report-flow.http` | T022, T026 |
