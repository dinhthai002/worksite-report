# Implementation Plan: Draft and submit a daily report

**Branch**: `002-draft-and-submit` | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-draft-and-submit/spec.md`

## Summary

The first feature of the `reporting` module: UC-1 Draft a report, UC-2 Submit a report, and viewing
a report with its history. Three endpoints, one new middleware, four tables.

- **Domain**: a `DailyReport` aggregate with `ReportItem` entities, a `WorkDate` value object, a
  `ReportStatus` transition table over all four statuses, and `ReportTransition` records. It
  implements BR-2 to BR-7 and BR-11, and decides who may view a report. `Progress` moves into
  `shared/domain`.
- **Reading the worksite**: the use cases load the whole `Worksite` through `worksite/index.ts`.
  The domain sees it through a reporting-owned interface that `Worksite` fits structurally, because
  ARC-01 forbids `reporting/domain` from importing `worksite` (research R1, R2).
- **Safe retries (BR-14)**: a claim-first idempotency middleware on every `POST` and `PUT`. It
  stores the response before sending it, and releases the key on failure (R9).
- **No silent overwrites (BR-15)**: every write is a conditional update on `version`, in one
  transaction with its items or transition (R10, R11).
- **BR-1**: a unique key on author, worksite and work date. A first save that finds or races into
  an existing report returns it unchanged (R8).

Approach and alternatives: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 6 (`strict`), Node.js 22

**Primary Dependencies**: Express 5, Zod 4, Prisma 6.19, pino. No new dependency: hashing uses
`node:crypto`

**Storage**: PostgreSQL 17. New enum `report_status`; new tables `daily_reports`,
`report_items`, `report_transitions`, `idempotency_keys`; one new trigger function

**Testing**: Jest 30 with ts-jest; Testcontainers (`postgres:17.11`) for integration and API tests;
supertest; `FixedClock` for every date rule

**Target Platform**: Linux container (Docker Compose: `db`, `migrate`, `api`)

**Project Type**: Web service (modular monolith backend)

**Performance Goals**: none beyond normal interactive use. A report holds at most the tasks of one
Foreman in one worksite; each request runs a handful of indexed queries in one transaction

**Constraints**: constitution v1.1.0; ARC-01 to ARC-04 checked by dependency-cruiser; every
report write conditional on `version` (DB-03)

**Scale/Scope**: 3 endpoints, 3 use cases, 1 middleware, 4 tables. The PRD example: 2 Foremen,
1 report each per day

No unknowns remain: the spec's five clarifications and the implementation plan's section 3
decisions cover every open point.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v1.1.0, before research and again after design.

| Principle | Result | How the design complies |
| --- | --- | --- |
| I. Documents First | Pass, with recorded divergences | The spec governs this step. Two implementation-plan details change in the same commit series (see "Documents updated"): the same-key concurrency test asserts only what the code guarantees (R18), and `report_items` uses a composite primary key instead of a separate `UNIQUE` (R12). The decision on who may view a report narrows the PRD Roles row; it is flagged for the product owner (P2) and `docs/product/` is not edited. UC-2's "Applies" line (P4) is stated in the spec, not resolved silently. The 365-day default for BR-2 differs from the 5 days in `use-cases.md`; the product owner changes that line in a separate approved edit before merge (R16) |
| II. A Person Approves Every Step | Pass | This plan awaits review before `/speckit-tasks` |
| III. Rules in the Domain, Boundaries | Pass | BR-2 to BR-7, BR-11 and FR-030 are methods of `DailyReport`, `ReportItem`, `WorkDate`, `ReportStatus`, each citing its ID. `reporting/domain` imports only itself and `shared/domain` (R1, R2). `reporting/application` reads `worksite` through `index.ts` only. One use case per file. Routes parse, call, map. Wiring in `main.ts`. Time from `Clock` |
| IV. Types, Naming, Comments | Pass | `ReportStatus` is a const object and union; mapper `switch` ends in `assertNever`. Branded `ReportId`, `WorkDate`, `Progress`; `WorksiteId` and `TaskId` move to `shared/domain` so both modules keep them (R1). Files: `save-draft.ts` → `SaveDraft` (NAM-04), suffixes per NAM-05 |
| V. Errors and HTTP Contract | Pass | 18 stable codes (R6), all `DomainError` subclasses except the `400`s, which come from Zod. `error-handler.ts` unchanged. Every body, path and query through `withValidInput`; the request key through Zod in the middleware. `Idempotency-Key` on `PUT` and `POST`; `version` in, `version` out ([contracts/](./contracts/)) |
| VI. Database Guards Integrity | Pass | BR-1 `UNIQUE`, BR-4 primary key, BR-5 `CHECK`, BR-11 append-only trigger, BR-14 primary key, note and key length `CHECK`s, idempotency completion `CHECK`. `P2002` translated at the repository (R8). Conditional writes on `version` (R10). Save and submit in one `$transaction` each (R11). Migration through `prisma migrate dev`, hand-written SQL added before commit |
| VII. Rules Traceable and Tested | Pass | Each of BR-1 to BR-7, BR-11, BR-14, BR-15 has unit tests named with its ID, and the database rules have integration tests (see Test plan). TST-11 table test over 16 pairs. Middleware: unit and API tests. Concurrency tests assert on outcome sets (R18) |
| VIII. Observable, One Config | Pass | No new configuration variable. The default of `BACKDATE_LIMIT_DAYS` becomes 365, defined once in `config.ts` (R16). `BACKDATE_LIMIT_DAYS` and `APP_TIME_ZONE` are read in `config.ts` and passed in `main.ts`. The request log line already carries actor and request IDs |
| IX. One Vocabulary | Pass | `DailyReport`, `ReportItem`, `ReportTransition`, `ReportStatus`, `WorkDate`, `Progress`, `approvedProgress`, `reportedProgress`, request key as `Idempotency-Key`: all glossary terms. `ReportWorksite` is reporting's view of a `Worksite`, not a new concept |
| X. Deliberate Simplicity | Pass | No new dependency, module or mechanism beyond what architecture.md already names (section 5.4 idempotency, 5.2 locking). No read model |

Re-check after Phase 1 design: unchanged, all pass. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/002-draft-and-submit/
├── spec.md
├── plan.md                 this file
├── research.md             Phase 0: decisions R1 to R18
├── data-model.md           Phase 1: domain model, tables, mapping, state diagram
├── quickstart.md           Phase 1: validation run
├── contracts/
│   ├── report-view.md      the report response shape
│   ├── save-draft.md       PUT /worksites/:worksiteId/reports/:workDate
│   ├── submit-report.md    POST /reports/:reportId/submit
│   ├── get-report.md       GET /reports/:reportId
│   └── idempotency.md      Idempotency-Key on every POST and PUT
├── checklists/requirements.md
└── tasks.md                Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

`+` new, `~` changed.

```text
prisma/
├── ~ schema.prisma                          enum ReportStatus; models DailyReport, ReportItem,
│                                            ReportTransition, IdempotencyKey; back-relations
└── + migrations/<timestamp>_create_reporting_tables/migration.sql
                                             generated, plus hand-written CHECKs and triggers

src/
├── ~ config.ts                              DEFAULT_BACKDATE_LIMIT_DAYS = 365, the schema default (R16)
├── ~ app.ts                                 AppDependencies gains idempotencyKeys, saveDraft,
│                                            submitReport, getReport; mounts idempotency, reportRoutes
├── ~ main.ts                                wires SystemClock(appTimeZone), backdateLimitDays,
│                                            the repositories and use cases
├── shared/
│   ├── domain/
│   │   ├── + ids.ts                         WorksiteId, TaskId moved here (R1)
│   │   └── + progress.ts                    Progress, isProgress, toProgress (R3)
│   └── infrastructure/
│       ├── + prisma-idempotency-key.repository.ts
│       └── http/
│           └── + idempotency.middleware.ts  IdempotencyKeyRepository port; claim, replay,
│                                            store or release (R9)
├── modules/worksite/
│   ├── domain/~ task.ts                     approvedProgress: Progress; TaskId from shared
│   ├── domain/~ worksite.ts                 WorksiteId from shared
│   ├── infrastructure/~ worksite.mapper.ts  toProgress
│   └── ~ index.ts                           re-exports WorksiteId, TaskId from shared
└── modules/reporting/
    ├── domain/
    │   ├── + daily-report.ts                DailyReport, ReportId, ReportStatus and its transition
    │   │                                    table, WorkDate (BR-2), ReportTransition (BR-11),
    │   │                                    ReportWorksite (R2); BR-3 to BR-7, FR-030
    │   ├── + report-item.ts                 ReportItem, BR-5 range
    │   └── + daily-report.repository.ts     DailyReportRepository port
    ├── application/
    │   ├── + get-report.ts                  GetReport (FR-030 to FR-033); ReportView, toReportView
    │   ├── + save-draft.ts                  SaveDraft (UC-1, BR-1)
    │   └── + submit-report.ts               SubmitReport (UC-2)
    ├── infrastructure/
    │   ├── + daily-report.mapper.ts
    │   └── + prisma-daily-report.repository.ts  conditional writes, item diff, P2002 → BR-1
    ├── interface/
    │   ├── + report.schemas.ts              params, body; item note refinement (R15)
    │   └── + report.routes.ts               the three endpoints through withValidInput
    └── ~ index.ts                           exports routes, use cases, repository

test/
├── support/
│   ├── ~ database.ts                        insertReport, insertReportItem (R17)
│   ├── ~ test-app.ts                        wires reporting and idempotency like main.ts
│   ├── ~ worksite.builder.ts                Progress for approved progress
│   └── + daily-report.builder.ts            aReport().withItems(…).rejected().build() (TST-10)
├── fakes/
│   ├── + in-memory-daily-report.repository.ts
│   └── + in-memory-idempotency-key.repository.ts
├── unit/
│   ├── shared/domain/+ progress.test.ts
│   ├── shared/infrastructure/http/+ idempotency.middleware.test.ts
│   └── modules/reporting/
│       ├── domain/+ daily-report.test.ts    one describe block each: status table (TST-11),
│       │                                    work date, the aggregate's rules
│       ├── domain/+ report-item.test.ts
│       ├── application/+ save-draft.test.ts
│       ├── application/+ submit-report.test.ts
│       └── application/+ get-report.test.ts
├── integration/
│   ├── + daily-report.repository.int.test.ts
│   ├── + idempotency-key.repository.int.test.ts
│   └── + reporting-schema.int.test.ts       CHECKs, keys, append-only trigger
└── api/
    ├── + save-draft.api.test.ts
    ├── + submit-report.api.test.ts
    ├── + get-report.api.test.ts
    ├── + idempotency.api.test.ts
    ├── + concurrency.api.test.ts
    ├── + permissions.api.test.ts
    └── + report-flow.api.test.ts            UC-1, UC-2 for the PRD example; extended in 003, 004

Other:
├── ~ docker-compose.yml                     BACKDATE_LIMIT_DAYS "365" (R16)
├── ~ .env.example                           BACKDATE_LIMIT_DAYS=365
├── ~ test/unit/config.test.ts               the default is 365
├── ~ http/report-flow.http                  Mark drafts, edits, submits on 20 November; Linda views
└── ~ README.md                              "Run it": the walkthrough's limit and why; starting over
```

Test files whose path mirrors an existing test (`worksite.test.ts`, `task.test.ts`,
`worksite.repository.int.test.ts`) change only where `approvedProgress` becomes a `Progress`.

**Structure Decision**: the existing modular monolith (architecture.md, section 3). `reporting`
has the same shape as `worksite`: one file for the aggregate root with its status and small value
types, one for the child entity, one for the port, and the view types in the read use case
(research R19). This feature fills in the `reporting` module, adds the idempotency middleware and its storage to `shared`, and
moves two ID types and `Progress` into `shared/domain`. `worksite` gains no dependency on
`reporting` (ARC-04).

### Configuration files touched

`docker-compose.yml` and `.env.example` change the backdating limit to the new default of 365
(FR-037a, R16). Neither is on the "do not edit to make a check pass" list, and the change is a
product decision, not a way to pass a check. `tsconfig.json`, `biome.json`,
`.dependency-cruiser.cjs` and the CI workflow are not touched.

### Documents updated in the same commit series

| Document | Change |
| --- | --- |
| `docs/engineering/architecture.md` §5.4 | Claim first; a duplicate in flight gets `409 IDEMPOTENCY_KEY_IN_PROGRESS`; the response is stored before it is sent; a failed request releases the key; a missing key is a `400` |
| `docs/engineering/architecture.md` §6 | Step 7: "on failure, the key is released" |
| `docs/engineering/architecture.md` §7 | `BACKDATE_LIMIT_DAYS` default `365` |
| `docs/engineering/implementation-plan.md` step 2 | Persistence row: `report_items` primary key `(report_id, task_id)`; `idempotency_keys` primary key `(actor_id, key)`. Tests rows: same-key concurrency per R18; `GET /reports/:id` permission cases; BR-5 range returns `422`; BR-2 at the 365-day default |
| `README.md` | "Run it": `docker compose down -v` to start the walkthrough over |
| `http/report-flow.http` | Draft, edit, submit, view, as in quickstart sections 3 and 6 |

Not edited, for the product owner (constitution I): `docs/product/` for P2 (who may view a report,
now settled in the spec), P4 (UC-2's "Applies" line), and BR-2's number of days (5 → 365).

## Test plan

Each row becomes at least one task. The build order follows the constitution: domain, use case,
repository, route. Rule IDs at the start of a row are the start of the test name (TST-01).

| Layer | Test | Covers |
| --- | --- | --- |
| Unit | `Progress`: 0 and 100 accepted; -1, 101, 55.5 rejected | BR-5 range; R3 |
| Unit | TST-11: all 16 pairs of `ReportStatus`, 4 allowed, 12 throw `INVALID_STATUS_TRANSITION` | FR-018; SC-007 |
| Unit | `BR-2` rejects a future date; rejects today − 366; accepts today − 365 and today; message gives both bounds; across a leap day | US1-4, US1-5; FR-004 |
| Unit | `BR-2` "today" follows the time zone: `FixedClock` at 18:30 UTC on 20 Nov in `Asia/Ho_Chi_Minh` accepts 21 Nov | US1-6 |
| Unit | `BR-3` rejects creating, editing and submitting for a `CLOSED` worksite | US1-7, US2-6; FR-005, FR-013 |
| Unit | `BR-4` rejects a duplicated task, a task of another worksite, a task assigned to another Foreman, each naming the task; on save and on submit | US1-8 to US1-10, US2-7; FR-006, FR-014 |
| Unit | `BR-5` rejects -1 and 101 on save naming the task; accepts 30 below approved 40 on save | US1-11, US1-12; FR-007 |
| Unit | `BR-5` rejects 30 below approved 40 on submit, naming task and 40; accepts 40 | US2-4, US2-5; FR-015 |
| Unit | `BR-6` rejects edits and submission by another Foreman; rejects edits in `SUBMITTED` and `APPROVED`, stating the status; allows edits in `REJECTED`, status unchanged | US2-8 to US2-11; FR-008, FR-011, FR-017 |
| Unit | `BR-7` rejects submitting a report with no items; allows saving one | US1-13, US2-3; FR-012 |
| Unit | `BR-11` submitting records one transition with from, to, actor, time from the clock, no reason; from `REJECTED` too | US2-1, US2-10; FR-019 |
| Unit | Site Supervisor cannot create, edit or submit (`ROLE_CANNOT_AUTHOR_REPORTS`) | US1-14, US2-12; FR-035 |
| Unit | `assertViewableBy`: author any status; supervisor not `DRAFT`; others refused | US4-1, US4-4 to US4-6; FR-030 |
| Unit | `SaveDraft` creates a `DRAFT` with version 1 and `created: true` | US1-1; FR-001 |
| Unit | `BR-1` saving again without a version returns the existing report unchanged, `created: false`, even with a date now out of range | US1-3; FR-003 |
| Unit | `SaveDraft` with a version replaces note and whole item list; a left-out task is gone | US1-2, US1-16; FR-002 |
| Unit | `BR-15` `SaveDraft` and `SubmitReport` with a stale version throw `REPORT_VERSION_CONFLICT` with the current version; a version with no report gives `currentVersion: null` | US3-7, US3-8; edge case; FR-027 |
| Unit | `SaveDraft`: unknown worksite → `WORKSITE_NOT_FOUND`; `SubmitReport`, `GetReport`: unknown report → `REPORT_NOT_FOUND` | US2-13, US4-3; FR-033 |
| Unit | `SubmitReport` leaves every task's approved progress unchanged | US2-2; FR-016 |
| Unit | `BR-14` middleware: runs and stores a first request; replays a completed one; rejects a different body (`422`); reports one in progress (`409`); releases the key on a `4xx` and a `5xx`; keys are per actor; missing or malformed key → `400`; `GET` untouched | US3-1 to US3-6; FR-021 to FR-026 |
| Integration | `BR-1` the unique key rejects a second report for the same Foreman, worksite and date; `add` returns the existing report with `created: false` | US3-9; FR-003 |
| Integration | `BR-4` the primary key rejects the same task twice in a report | FR-006 |
| Integration | `BR-5` `reported_progress` -1 and 101 rejected by the database | FR-007 |
| Integration | `BR-11` `report_transitions` rejects `UPDATE` and `DELETE` | FR-020; SC-006 |
| Integration | `BR-14` the primary key rejects a second claim of the same actor and key; the same key for two actors is accepted; completion `CHECK` | FR-025 |
| Integration | `BR-15` a save with a stale version updates zero rows, raises a conflict and rolls back items | FR-027; SC-003 |
| Integration | Mapper round trip: a report with items and transitions loads back equal | FR-031 |
| Integration | Item order: changed item first; transitions oldest first | FR-032 |
| Integration | Item diff: unchanged items keep `updated_at`; removed items are deleted | FR-002, FR-032; R11 |
| Integration | Note length `CHECK` on both tables | FR-002a |
| API | `PUT` `201` with `version` 1; `200` on edit; `200` with the existing report (BR-1); `400` for a bad date, a non-integer progress, a 2,001-character item note naming the task, unknown fields; `422` for each rule; `409` for `SUBMITTED` | US1; FR-001 to FR-009; edge cases |
| API | `POST …/submit` `200` with the transition; `409` stale version and `SUBMITTED`; `422` no items, below approved, closed worksite, reassigned task; `404` unknown report | US2 |
| API | `GET /reports/:id` returns report, items, transitions; `404`; `403` cases of FR-030 | US4 |
| API | `idempotency.api.test.ts`: 5 identical saves → 1 report, 5 identical responses; same key with another body → `422`; missing key → `400`; two concurrent same-key requests → one report, outcomes per R18 | US3-1 to US3-6; SC-002 |
| API | `concurrency.api.test.ts`: two saves from one version → one `200`, one `409` with `currentVersion`; ten concurrent first saves → one report | US3-7, US3-9; SC-003, SC-004 |
| API | `permissions.api.test.ts`: Site Supervisor save and submit → `403`; Mark reports on Henry's task → `422`; Henry submits Mark's report → `403` | US1-9, US1-14, US2-11, US2-12 |
| API | `report-flow.api.test.ts`: Mark drafts walls at 55% for 20 Nov, edits, submits; walls still 40% | SC-001; plan exit criterion |
| Manual | [quickstart.md](./quickstart.md) sections 2 to 7, and `http/report-flow.http` | FR-037, FR-037a; SC-008 |

## Complexity Tracking

No constitution violations. Nothing to justify.
