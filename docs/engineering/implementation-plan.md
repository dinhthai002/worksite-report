# Implementation plan

- Scope: the order in which the PRD is built, as five Spec-Kit features. Each step is one complete, testable use case.
- Related documents: [PRD](../product/prd.md), [Use cases and business rules](../product/use-cases.md), [Glossary](../glossary.md), [Architecture](./architecture.md), [Coding standard](./coding-standard.md), [Testing](./testing.md), [Workflow](./workflow.md), [ADRs](../adr/).
- This plan is input for `/speckit-specify`. Once a step has its own `specs/NNN-name/`, the spec, plan and tasks there are the detailed source of truth for that step (workflow.md, section 2).

## 1. How to use this plan

For each step, in order:

1. Run `/speckit-specify` with the step's **Goal** and **Scope** as input.
2. Run `/speckit-clarify`, starting from the step's **Questions to settle**.
3. Run `/speckit-plan`. The step's **What to implement** is the starting point for `plan.md`, `data-model.md` and `contracts/`.
4. Run `/speckit-tasks` and `/speckit-analyze`. Every test listed under **Tests** must map to a task.
5. Run `/speckit-implement`, then check every item under **Exit criteria**.

A person reviews and approves the output of every Spec-Kit command before the next one starts (workflow.md, section 1).

Within a step, build in this order: domain and its unit tests, then use cases and their unit tests, then repositories, migrations and integration tests, then routes and API tests (workflow.md, section 3).

### 1.1 Exit criteria shared by every step

These apply to every step, in addition to the step's own exit criteria:

- [ ] `npm run check` passes: typecheck, Biome, dependency-cruiser, unit tests.
- [ ] `npm run test:all` passes: unit, integration and API tests against PostgreSQL in Testcontainers.
- [ ] `npm run test:cov` meets the 90% floor for `domain` and `application`.
- [ ] Every business rule the step implements has at least one test whose name starts with its ID (TST-01).
- [ ] `docker compose up --build` starts, `migrate` exits 0, and `GET /health` returns 200.
- [ ] Every new `POST` and `PUT` requires `Idempotency-Key` (API-02), from step 2 onward.
- [ ] Documents affected by the step are updated in the same commit series.
- [ ] Commits follow Conventional Commits, one logical change each, and the build passes at every commit.

## 2. Overview

| Step | Feature | Use case | New business rules | Endpoints | New tables | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Spec-Kit setup | — | — | — | — | Done |
| 1 | `001-worksite-seed` | View a worksite and its tasks, from seeded data | none (identity and data foundation) | `GET /worksites/:worksiteId` | `users`, `worksites`, `tasks` | Done |
| 2 | `002-draft-and-submit` | UC-1 Draft a report, UC-2 Submit a report | BR-1 to BR-7, BR-11, BR-14, BR-15 | `PUT /worksites/:worksiteId/reports/:workDate`, `POST /reports/:reportId/submit`, `GET /reports/:reportId` | `daily_reports`, `report_items`, `report_transitions`, `idempotency_keys` | Done |
| 3 | `003-approve-report` | UC-3 Approve a report | BR-5 (at approval), BR-9, BR-10, BR-12 | `POST /reports/:reportId/approve` | none | Done |
| 4 | `004-reject-and-resubmit` | UC-4 Reject and resubmit, plus the full PRD flow end to end | BR-8 | `POST /reports/:reportId/reject` | none | Done |
| 5 | `005-worksite-management` | Create a worksite, add tasks, assign and reassign foremen | BR-13 | `POST /worksites`, `POST /worksites/:worksiteId/tasks`, `PUT /tasks/:taskId/assignee` | none | Not started |

Until step 5 is done, the PRD actions "Create a worksite" and "Create tasks and assign a foreman to each" have no endpoint, and BR-13 has no code or test. Worksites and tasks come only from the seed and the test builders.

Each step depends on the one before it. Tables are created in the step that first uses them, so each table is designed after its step's spec is clarified (architecture.md, section 5; DB-05).

## 3. Decisions carried into the specs

These were decided before the Spec-Kit work started. Specs apply them; they are not re-opened in clarify.

| Topic | Decision | Applies in |
| --- | --- | --- |
| Unknown actor | The actor middleware looks up `X-Actor-Id` in `users`. An unknown ID, or an `X-Actor-Role` different from the stored role, returns `401` | Step 1 |
| `Role` in code | A `Role` const object (`Role.FOREMAN`, `Role.SITE_SUPERVISOR`) plus the `Role` type, matching the glossary | Step 1 |
| Clock | `Clock.today()` returns the calendar date in `APP_TIME_ZONE`; the domain compares calendar dates only (BR-2) | Step 2 |
| Progress range in the database | `CHECK` 0 to 100 on both `tasks.approved_progress` and `report_items.reported_progress` | Steps 1 and 2 |
| Idempotency (BR-14) | Claim the key first: insert `(actor_id, key, request_hash)` with an empty response. A concurrent duplicate gets `409 IDEMPOTENCY_KEY_IN_PROGRESS`. Store the response on completion; release the key on failure. `response_status`, `response_body` and `completed_at` are nullable | Step 2 |
| Reading another module | `reporting` loads the whole `Worksite` aggregate through `worksite/index.ts` | Steps 2 and 3 |
| Read endpoints | `GET` routes call a read use case that loads the aggregate. No separate read model | Steps 1 and 2 |
| Identity | Domain factories take an `id`. Use cases generate it with `crypto.randomUUID()` | Steps 2 and 5 |
| Approval transaction | One transaction across `DailyReport` and the worksite's tasks (ADR 0004) | Step 3 |
| Closing a worksite | No endpoint. `CLOSED` is set only by seed data and test builders | All |

Earlier design notes (module files, domain model, endpoint list, table list, approval transaction code) are in git history: `git show ff2b8c8:docs/engineering/architecture.md`, sections 3 to 7.

---

## Step 0: Spec-Kit setup

**Goal.** The repository is ready for the Spec-Kit workflow.

**What to implement.**

- Run `specify init --here --integration claude`. This uses the templates bundled with `specify` 1.0.6, with no network access. Do not install the `opensend` preset.
- Write `.specify/memory/constitution.md` from workflow.md section 1 and the coding standard (workflow.md, section 4).
- Ask the product owner the open questions in section 5 of this plan. Steps 1 and 2 need the answers.

**Exit criteria.**

- [ ] `.specify/` exists, and the `/speckit-*` commands are available after restarting Claude Code.
- [ ] The constitution has been reviewed and approved.
- [ ] The setup is committed: `chore: set up Spec-Kit`.

---

## Step 1: `001-worksite-seed`

**Goal.** A started system contains the townhouse example from the PRD. Any known user can view a worksite and its tasks. Unknown callers are rejected.

**Scope.**

- Use case: view a worksite and its tasks. Both roles may view (PRD, Roles).
- Identity: every request except `GET /health` must come from a user in `users`, with the role stored for that user.
- No business rules from use-cases.md yet. This step builds the data and identity foundation the later steps rely on.

**What to implement.**

| Layer | Work |
| --- | --- |
| Persistence | Prisma models and migration for `users` (id, name, role), `worksites` (id, name, supervisor, status `ACTIVE`/`CLOSED`) and `tasks` (id, worksite, name, assignee, `approved_progress` default 0). Every table has `created_at` and `updated_at`, kept by the `set_updated_at()` trigger. Hand-written `CHECK (approved_progress BETWEEN 0 AND 100)`. Tables and columns are `snake_case` (NAM-06) |
| Seed | `prisma/seed.ts`: Linda (site supervisor), Mark and Henry (foremen), worksite "Three-storey townhouse" (`ACTIVE`, supervised by Linda), tasks Pour foundation (Mark, 100), Build ground-floor walls (Mark, 40), Install electrical (Henry, 0). Fixed UUIDs. Two modes: fill (adds missing rows, changes nothing that exists), run by the compose `migrate` service after `migrate deploy`; reset (restores the PRD values), run by `npx prisma db seed` |
| `shared/domain` | `Role` const object and type (glossary) |
| `worksite/domain` | `Worksite` aggregate with `Task` entities, `WorksiteStatus`, branded `WorksiteId` and `TaskId`, `WorksiteRepository` port |
| `worksite/application` | `GetWorksite` use case: returns the worksite with its tasks, or `NotFoundError` |
| `worksite/infrastructure` | `PrismaWorksiteRepository`, `worksite.mapper.ts` |
| `worksite/interface` | `worksite.routes.ts` with `GET /worksites/:worksiteId`, `worksite.schemas.ts` |
| `worksite/index.ts` | Exports what `app.ts` needs to mount the routes, and the aggregate and port that step 2 will read |
| `shared/infrastructure` | The actor middleware checks the user and role against `users` |
| `test/` | `test/support/` truncation helper (TST-08); remove `--passWithNoTests` from `test:int` |
| Other | `http/report-flow.http` gets a "view the seeded worksite" request; README "Run it" describes the seed accurately |

**Tests.**

| Layer | Test |
| --- | --- |
| Unit | `GetWorksite` returns the worksite with its tasks; throws `NotFoundError` for an unknown ID (in-memory fake repository) |
| Unit | `Role` holds exactly `FOREMAN` and `SITE_SUPERVISOR` |
| Integration | Worksite mapper round trip: a saved worksite loads back equal |
| Integration | `tasks.approved_progress` outside 0 to 100 is rejected by the database |
| Integration | Running the seed twice leaves exactly one copy of each row |
| API | `GET /worksites/:id` returns `200` with three tasks for Linda, two for Mark and one for Henry |
| API | Unknown worksite returns `404` |
| API | Missing actor headers, an unknown user ID, or a role that does not match the stored role return `401` |
| API | Unknown route returns `404 ROUTE_NOT_FOUND`; malformed JSON returns `400 MALFORMED_JSON`; `X-Request-Id` is echoed, or generated when missing or unsafe |

**Exit criteria.**

- [ ] The shared exit criteria in 1.1 are met.
- [ ] After `docker compose up --build`, `GET /worksites/<townhouse id>` as Linda returns the three tasks with approved progress 100, 40 and 0.
- [ ] `npm run test:int` runs at least one test, without `--passWithNoTests`.

**Questions to settle in `/speckit-clarify`.**

- Does a foreman see every task of the worksite, or only the tasks assigned to them? The PRD says both roles can view worksites and tasks.
- Does the worksite view include each task's assignee and approved progress?

---

## Step 2: `002-draft-and-submit`

**Goal.** A foreman creates a daily report for a work date, saves it as a draft any number of times, and submits it for review. Retries never create duplicates, and a stale save is rejected.

**Scope.**

- UC-1 Draft a report: BR-1, BR-2, BR-3, BR-4, BR-5 (range only), BR-14, BR-15.
- UC-2 Submit a report: BR-3, BR-4, BR-5, BR-6, BR-7.
- BR-11 starts here: the first recorded transition is a submission.
- Viewing a report and its history (`GET /reports/:reportId`).

**What to implement.**

| Layer | Work |
| --- | --- |
| `shared/domain` | `Progress` value object: an integer from 0 to 100 (BR-5 range) |
| `reporting/domain` | `DailyReport` aggregate with `ReportItem` entities. `WorkDate` value object, validated against `Clock.today()` and the backdating limit (BR-2). `ReportStatus` with one transition table covering all four statuses (TST-11). `ReportTransition` records actor, time with offset, and reason (BR-11). `DailyReportRepository` port. Rules: BR-3 worksite must be `ACTIVE`; BR-4 each task appears once, belongs to the worksite and is assigned to the author; BR-5 reported progress is not below approved progress, checked at submit; BR-6 only the author edits, only in `DRAFT` or `REJECTED`; BR-7 at least one item to submit |
| `reporting/application` | `SaveDraft` (UC-1: creates or updates the caller's report for the work date; BR-1 returns the existing report instead of creating a new one). `SubmitReport` (UC-2). `GetReport` (the report with its transitions) |
| `reporting/infrastructure` | `PrismaDailyReportRepository`: every write is conditional on `version` and increments it (BR-15, DB-03); `P2002` becomes a domain error (ERR-04); a concurrent first save resolves to the existing report (BR-1). `daily-report.mapper.ts` |
| Persistence | Migration for `daily_reports` (`UNIQUE (worksite_id, author_id, work_date)`, `version`), `report_items` (primary key `(report_id, task_id)`, `CHECK (reported_progress BETWEEN 0 AND 100)`), `report_transitions` (append-only: a trigger rejects `UPDATE` and `DELETE`), `idempotency_keys` (primary key `(actor_id, key)`, nullable response columns, `completed_at`) |
| `shared/infrastructure/http` | `idempotency.middleware.ts`: claim-first idempotency for every `POST` and `PUT` (BR-14, API-02) |
| `reporting/interface` | `report.routes.ts`: `PUT /worksites/:worksiteId/reports/:workDate`, `POST /reports/:reportId/submit`, `GET /reports/:reportId`. `report.schemas.ts`. Requests carry `version`; every report response includes the current `version` (API-04) |
| Wiring | `main.ts` creates `SystemClock` from `APP_TIME_ZONE` and passes it and `BACKDATE_LIMIT_DAYS` to the use cases |
| Other | `http/report-flow.http`: Mark drafts and submits his report for 20 November |

**Tests.**

| Layer | Test |
| --- | --- |
| Unit | TST-11: a table-driven test over all 16 pairs of statuses, each either allowed or rejected |
| Unit | `BR-1` saving again for the same worksite and work date returns the existing report |
| Unit | `BR-2` rejects a future work date; rejects a date more than the limit before today; accepts the boundary date; "today" follows `APP_TIME_ZONE` (`FixedClock` near midnight). Tested at the default limit of 365 days |
| Unit | `BR-3` rejects saving and submitting for a `CLOSED` worksite |
| Unit | `BR-4` rejects a duplicated task, a task from another worksite, and a task assigned to another foreman, naming the task |
| Unit | `BR-5` rejects progress outside 0 to 100 on save, naming the task, as a `422` rule violation from the domain (not a `400` from the schema); rejects progress below approved progress on submit, naming the task and its approved progress |
| Unit | `BR-6` rejects edits by another foreman, and edits in `SUBMITTED` or `APPROVED` |
| Unit | `BR-7` rejects submitting a report with no items |
| Unit | `BR-11` submitting records a transition with actor and time |
| Unit | `BR-14` the middleware replays a stored response, rejects a reused key with a different body, and reports a key still in progress |
| Integration | `BR-1` the unique constraint rejects a second report for the same foreman, worksite and work date |
| Integration | `BR-4` the primary key of `report_items` rejects the same task twice in a report |
| Integration | `BR-5` `report_items.reported_progress` outside 0 to 100 is rejected by the database |
| Integration | `BR-11` `report_transitions` rejects `UPDATE` and `DELETE` |
| Integration | `BR-14` the primary key of `idempotency_keys` rejects a second claim of the same actor and key |
| Integration | `BR-15` a save with a stale `version` updates zero rows and raises a conflict |
| Integration | Report mapper round trip |
| API | `idempotency.api.test.ts`: five identical requests yield one report and five identical responses (UC-1 acceptance); the same key with a different body returns `422`; two concurrent requests with the same key create one report, and either one succeeds and the other returns `409 IDEMPOTENCY_KEY_IN_PROGRESS`, or both return the same success (the second arrived after the first was stored). The `409` itself is proven deterministically by the middleware's unit test |
| API | `concurrency.api.test.ts`: two saves from the same version: one succeeds, one returns `409` with the current version (UC-1 acceptance) |
| API | Draft and submit succeed and return `version`; invalid body returns `400`; a site supervisor saving a draft returns `403`; reporting on another foreman's task returns `422` |
| API | `GET /reports/:id` returns the report, its items and its transitions to the author; the worksite's site supervisor gets `200` once submitted and `403` for a draft; another foreman and the supervisor of another worksite get `403`; an unknown report gets `404` |

**Exit criteria.**

- [ ] The shared exit criteria in 1.1 are met.
- [ ] Every UC-1 acceptance criterion in use-cases.md has a passing test.
- [ ] Using `http/report-flow.http`, Mark drafts "Build ground-floor walls" at 55% for 20 November, edits it, and submits it. Approved progress is still 40%.

**Questions to settle in `/speckit-clarify`.**

- Does saving a draft replace the whole list of items, or update individual items?
- Can a draft hold a note per report and per item (the PRD model has both), and are they required?
- Who may view a report: any user, or only the author and the worksite's site supervisor?
- When a worksite is closed after a report is drafted but before it is submitted, is submission rejected (BR-3)? The rule says yes; confirm the message.

---

## Step 3: `003-approve-report`

**Goal.** The site supervisor approves a submitted report, and the approved progress of every task in it is updated together, or nothing changes.

**Scope.**

- UC-3 Approve a report: BR-5 (checked again at approval), BR-9, BR-10, BR-12, BR-15.

**What to implement.**

| Layer | Work |
| --- | --- |
| `reporting/domain` | `DailyReport.approve()`: allowed only from `SUBMITTED` (BR-10), records the transition (BR-11) |
| `reporting/application` | `ApproveReport`: loads the report and its worksite through `worksite/index.ts`; rejects anyone but the worksite's site supervisor (BR-12); fails fast if a task's approved progress is already higher (BR-5) |
| `reporting/infrastructure` | The approval write, in one transaction (ADR 0004): update the report conditionally on `version` and `status = SUBMITTED`, then raise each task, in ascending task ID order so concurrent approvals cannot deadlock, with `WHERE approved_progress < reported_progress`, and fail if a task not raised is above the reported progress; then record the transition. Any failed condition rolls back everything (BR-9). A task already at the reported value is not written, so it keeps its place in the worksite's list. Together the two conditions accept exactly the tasks ADR 0004's `<=` accepts (003 research R4) |
| `worksite/index.ts` | Exports what `reporting` needs to read: the worksite's supervisor and each task's approved progress. Already satisfied by feature 002; no change (003 research R7) |
| `reporting/interface` | `POST /reports/:reportId/approve` with `version` in the body |
| Other | `http/report-flow.http`: Linda approves Mark's report |

**Tests.**

| Layer | Test |
| --- | --- |
| Unit | `BR-10` an `APPROVED` report cannot be approved again, edited or submitted |
| Unit | `BR-12` rejects approval by a foreman and by the supervisor of another worksite; approving a `DRAFT` gets exactly the same `403` |
| Unit | `BR-5` rejects approval when a task's approved progress is already above the reported progress, listing every such task with both figures |
| Integration | `BR-9` approval where one task's progress is already higher rolls back: the report stays `SUBMITTED` and no task changes (UC-3 acceptance) |
| Integration | `BR-15` two approvals of the same report started together: exactly one succeeds (UC-3 acceptance) |
| Integration | `BR-5` reports approved out of date order: approving the 19th at 40% after the 20th at 60% fails |
| API | Approval returns the new `version` and the tasks show the reported progress as approved progress |
| API | A foreman, and the supervisor of another worksite, get `403` (UC-3 acceptance); a stale `version` gets `409`; of two approvals at once, the loser always gets `409 REPORT_VERSION_CONFLICT`; a body with a comment gets `400`; a repeated `Idempotency-Key` replays the response |

**Exit criteria.**

- [ ] The shared exit criteria in 1.1 are met.
- [ ] Every UC-3 acceptance criterion in use-cases.md has a passing test.
- [ ] PRD example, row "Linda approves Mark's report": "Build ground-floor walls" becomes 55%, "Install electrical" stays 0%.

**Questions to settle in `/speckit-clarify`.**

- When approval fails because of BR-5, does the response name every task below approved progress, or the first one?
- Can a report be approved after one of its tasks was reassigned? BR-4 says assignment is not re-checked at approval, so yes; confirm.

---

## Step 4: `004-reject-and-resubmit`

**Goal.** The site supervisor rejects a report with a reason. The foreman sees the reason, edits the report and resubmits it. The whole PRD example runs end to end.

**Scope.**

- UC-4 Reject and resubmit: BR-6, BR-8, BR-11, BR-12.
- Concurrency between approve and reject (BR-15).
- End-to-end verification of UC-1 to UC-4 and the PRD example.

**What to implement.**

| Layer | Work |
| --- | --- |
| `reporting/domain` | `DailyReport.reject(reason)`: allowed only from `SUBMITTED` (BR-10); the reason is required (BR-8), checked after permission and status, and stored on the transition as sent (BR-11). BR-12 is one private check shared with `assertCanApprove`; rejection has its own code, `REPORT_REJECTION_FORBIDDEN` (004 research R2) |
| `reporting/application` | `RejectReport`: only the worksite's site supervisor (BR-12). Editing and resubmitting reuse `SaveDraft` and `SubmitReport` on a `REJECTED` report |
| `reporting/infrastructure` | No new repository method: a rejection is stored with `save`, conditional on `version` (004 research R4). A migration adds two `CHECK`s on `report_transitions`: `reason` at most 2,000 characters, and a `REJECTED` transition has a non-blank reason (R5) |
| `reporting/interface` | `POST /reports/:reportId/reject` with `version` and `reason`. A reason over 2,000 characters is a `400`; a missing, empty or blank one is `422 REJECTION_REASON_REQUIRED` |
| Other | `http/report-flow.http` walks through the whole PRD example. README "Run it" matches what the file does |

**Tests.**

| Layer | Test |
| --- | --- |
| Unit | `BR-8` rejects a rejection with a missing, empty or blank reason, after permission, version and status |
| Unit | `BR-10` an `APPROVED` report cannot be rejected |
| Unit | `BR-6` the author can edit a `REJECTED` report; others cannot |
| Unit | `BR-11` the rejection transition records actor, time and reason |
| Unit | `BR-12` rejects rejection by a foreman and by the supervisor of another worksite; rejecting a `DRAFT` gets exactly the same `403 REPORT_REJECTION_FORBIDDEN` |
| Unit | TST-11 table updated, if the transition table changed |
| Integration | `BR-15` approve and reject started together: exactly one succeeds |
| Integration | `BR-8` the database refuses a `REJECTED` transition without a non-blank reason, and any reason over 2,000 characters |
| API | `report-flow.api.test.ts`: UC-1 to UC-4 in sequence: draft, submit, reject, edit, resubmit, approve, then check task progress |
| API | `concurrency.api.test.ts`: approve and reject at once, the loser always `409 REPORT_VERSION_CONFLICT`; a reason over 2,000 characters is a `400` |
| API | `permissions.api.test.ts`: a foreman cannot approve or reject; a foreman cannot report on another foreman's task; a supervisor of another worksite cannot approve or reject |
| API | Task progress does not change at any point before the final approval (UC-4 acceptance) |

**Exit criteria.**

- [ ] The shared exit criteria in 1.1 are met.
- [ ] Every UC-4 acceptance criterion in use-cases.md has a passing test.
- [ ] The PRD example passes as an API test, row by row: Mark and Henry submit; Linda approves Mark's report (walls 55%); Linda rejects Henry's report with the reason "conduit laid, no wiring pulled yet" (electrical stays 0%); Henry changes the figure to 5% and resubmits; Linda approves (electrical 5%).
- [ ] The same walkthrough works by hand with `http/report-flow.http` against `docker compose up --build`.
- [ ] PRD implementation goals 1 to 3 (safe retries, no silent overwrites, atomic approval) each have a passing API or integration test.

**Questions to settle in `/speckit-clarify`.**

- Is there a maximum length for the rejection reason? Answered in 004 clarify: 2,000 characters, as for notes.
- After a rejection, does the foreman see the reason through `GET /reports/:reportId` only, or also in the response of the next save? Answered: both; every response that returns the report carries its history with reasons.

---

## Step 5: `005-worksite-management`

**Goal.** A site supervisor creates worksites and tasks through the API, assigns each task to a foreman, and reassigns tasks, instead of relying on seed data.

**Scope.**

- PRD Roles table: create a worksite; create tasks and assign a foreman to each.
- BR-13: a task is assigned to exactly one foreman; only the worksite's site supervisor can assign or reassign it; reassignment does not change existing reports.
- use-cases.md has no use case for this yet (see section 5). The spec is derived from the PRD and BR-13.

**What to implement.**

| Layer | Work |
| --- | --- |
| `worksite/domain` | `Worksite.create`: the creating site supervisor becomes its supervisor. `addTask` and `reassign`: the assignee must be a foreman; only the worksite's supervisor may do it (BR-13) |
| `worksite/application` | `CreateWorksite`, `AddTask`, `AssignTask` |
| `worksite/interface` | `POST /worksites`, `POST /worksites/:worksiteId/tasks`, `PUT /tasks/:taskId/assignee`. All require `Idempotency-Key`. Each is described in `worksite.openapi.ts` (API-05) |
| Other | `http/report-flow.http`: creating a second worksite and reassigning a task |

**Tests.**

| Layer | Test |
| --- | --- |
| Unit | `BR-13` rejects assignment by a foreman and by the supervisor of another worksite |
| Unit | `BR-13` rejects assigning a task to a user who is not a foreman |
| Unit | Only a site supervisor can create a worksite |
| API | A site supervisor creates a worksite, adds a task with an assignee, and reassigns it; a foreman gets `403` for each |
| API | `BR-13` reassigning a task that is in a `SUBMITTED` report: the report can still be approved, and the previous assignee can no longer save that task (BR-4) |
| API | A repeated `Idempotency-Key` on each new endpoint replays the response and creates no new row |

**Exit criteria.**

- [ ] The shared exit criteria in 1.1 are met.
- [ ] Every action in the PRD Roles table is available through the API and covered by an API test.
- [ ] **PRD complete:** BR-1 to BR-15 each have at least one test whose name starts with the rule ID (TST-01). A search for each ID in `test/` finds a match.

**Questions to settle in `/speckit-clarify`.**

- Can a site supervisor assign a task to themselves? BR-13 requires a foreman, so no; confirm.
- Can tasks be renamed or deleted?
- Is closing a worksite in scope? BR-3 depends on `CLOSED`, but neither the PRD nor this plan has an action for it.

---

## 4. Traceability

### 4.1 Business rules

| Rule | Step | Rule | Step |
| --- | --- | --- | --- |
| BR-1 | 2 | BR-9 | 3 |
| BR-2 | 2 | BR-10 | 3, tested again in 4 |
| BR-3 | 2 (status exists from step 1) | BR-11 | 2, 4 |
| BR-4 | 2, tested again in 5 | BR-12 | 3, 4 |
| BR-5 | 2 (range, at submit), 3 (at approval) | BR-13 | 5 |
| BR-6 | 2, 4 | BR-14 | 2, reused in 3 to 5 |
| BR-7 | 2 | BR-15 | 2, 3, 4 |
| BR-8 | 4 | | |

### 4.2 Use cases and PRD goals

| Item | Step |
| --- | --- |
| UC-1 Draft a report | 2 |
| UC-2 Submit a report | 2 |
| UC-3 Approve a report | 3 |
| UC-4 Reject and resubmit | 4 |
| PRD Roles: view worksites, tasks and reports | 1, 2 |
| PRD Roles: create worksites, create and assign tasks | 5 |
| PRD example (three-storey townhouse) | Seeded in 1, verified end to end in 4 |
| Goal 1: safe retries | 2 |
| Goal 2: no silent overwrites | 2 |
| Goal 3: atomic approval | 3 |

## 5. Open product questions

These need the product owner, because `docs/product/` and the glossary are changed only by them. They should be answered before the step that needs them.

| # | Question | Needed by |
| --- | --- | --- |
| P1 | use-cases.md has no use case for worksite setup (create worksite, add task, assign). Add one with acceptance criteria? | Step 5 |
| P2 | use-cases.md has no use case for viewing a report and its history. Who may view a report? Answered 2026-11-26: UC-5 View a report | Step 2 |
| P3 | Nothing closes a worksite, but BR-3 depends on `CLOSED`. Add an action, or confirm it stays out of scope? | Step 2 |
| P4 | BR-14 and BR-15 apply to every write, but UC-2 and UC-4 do not list them, and UC-3 lists only BR-15. Align the "Applies" lines? Answered 2026-11-26: UC-2 to UC-4 list them | Step 2 |
| P5 | The glossary has no entry for "User", although the PRD model has a `USER` entity. Add one? | Step 1 |
| P6 | BR-3 lets a `SUBMITTED` report be rejected after its worksite is closed, but refuses saving and submitting on a closed worksite, so that report stays `REJECTED` for good. Accept this, or let the author edit and resubmit it? Feature 004 builds the rules as written | After Step 4 |
