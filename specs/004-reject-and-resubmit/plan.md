# Implementation Plan: Reject and resubmit a daily report

**Branch**: `main` (the repository works on `main`; the feature is identified by `.specify/feature.json`) | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-reject-and-resubmit/spec.md`

## Summary

UC-4 Reject and resubmit, and the whole PRD example end to end: one endpoint, one use case, two
domain methods, one migration with two `CHECK`s. No new port method, no new table.

- **Domain**: `DailyReport.reject` (BR-12 through a new `assertCanReject`, BR-10 through the existing
  transition table, BR-8, BR-11 transition with the reason). BR-12 is implemented once, in a private
  `assertDecidableBy` that approval and rejection share; rejection has its own code,
  `REPORT_REJECTION_FORBIDDEN` (research R2, R3).
- **Order of checks**: existence, permission, version, status, reason. The loser of any race on a
  report gets `REPORT_VERSION_CONFLICT`, and a missing reason is the last thing checked
  (R1; Clarifications Q2).
- **The write**: the existing `save`, conditional on `version`. Approval against rejection is
  decided by the report row: whichever commits first changes the version, and the other matches
  zero rows and rolls back (R4).
- **The database** guards the reason: at most 2,000 characters, and present and not blank on every
  `REJECTED` transition (R5).
- **Request**: `{ "version": n, "reason": "…" }`. A reason over 2,000 characters is a `400`;
  missing or blank is `422 REJECTION_REASON_REQUIRED` (R6).
- **Editing and resubmitting** need no code: feature 002 already allows both on a `REJECTED`
  report, and every report response already carries the reason (R7).
- **End to end**: one API test runs the PRD example row by row; `http/report-flow.http` is
  reordered to follow the PRD table, and README "Run it" describes it (R8, R9).

Approach and alternatives: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 6 (`strict`), Node.js 22

**Primary Dependencies**: Express 5, Zod 4, Prisma 6.19, pino. No new dependency

**Storage**: PostgreSQL 17. One new migration: two `CHECK` constraints on `report_transitions`. A
rejection writes `daily_reports` and `report_transitions` in one transaction

**Testing**: Jest 30 with ts-jest; Testcontainers (`postgres:17.11`) for integration and API tests;
supertest; `FixedClock`; in-memory fakes for unit tests

**Target Platform**: Linux container (Docker Compose: `db`, `migrate`, `api`)

**Project Type**: Web service (modular monolith backend)

**Performance Goals**: none beyond normal interactive use. A rejection is one conditional update
and one insert

**Constraints**: constitution v1.1.0; every report write conditional on `version` (DB-03); ADR 0004
unaffected (rejection writes no task)

**Scale/Scope**: 1 endpoint, 1 use case, 3 public aggregate methods (2 new: `assertCanReject`,
`reject`; 1 refactored: `assertCanApprove`) and 1 private (`assertDecidableBy`), 1 migration, 2 new
error codes

No unknowns remain: the spec's four clarifications and features 002 and 003 cover every open point.
Features 002 and 003 are committed (through `fdd369a`), so this feature starts from a clean tree
(R12).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v1.1.0, before research and again after design.

| Principle | Result | How the design complies |
| --- | --- | --- |
| I. Documents First | Pass, with stated conflicts | The spec governs. Its two stated gaps are not resolved silently: UC-4's "Applies" line omits BR-10, which the spec applies anyway; a report rejected after its worksite closes cannot be resubmitted, built as written and raised as P6. `docs/product/` and `docs/adr/` are not edited |
| II. A Person Approves Every Step | Pass | This plan awaits review before `/speckit-tasks` |
| III. Rules in the Domain, Boundaries | Pass | BR-8, BR-10 and BR-12 are in `DailyReport`, each citing its ID. BR-12 is written once, shared by approval and rejection (R2). The migration's `CHECK`s are database guards (DB-02), not a second copy of the rule: the domain decides, and the guard can only refuse what the domain would refuse (R3, R5). One use case in `reject-report.ts`; the route parses, calls, maps. Time from `Clock`. No change to `worksite` |
| IV. Types, Naming, Comments | Pass | `reject-report.ts` exports `RejectReport` (NAM-04). No new union, so no new `switch`. `reason: string \| null`, no `any` |
| V. Errors and HTTP Contract | Pass | Two new stable codes: `REPORT_REJECTION_FORBIDDEN` (`ForbiddenError`, `403`) and `REJECTION_REASON_REQUIRED` (`RuleViolationError`, `422`); the rest reused. `error-handler.ts` unchanged. Body and path through `withValidInput`; `Idempotency-Key` by the existing middleware; `version` in, `version` out ([contracts/reject-report.md](./contracts/reject-report.md)) |
| VI. Database Guards Integrity | Pass | New migration, `CHECK`s added to the generated SQL before commit; no committed migration edited (DB-05). The write is `save`: one `$transaction`, conditional on `version`, incrementing it (DB-03, DB-04). Append-only trigger still applies |
| VII. Rules Traceable and Tested | Pass | BR-6, BR-8, BR-10, BR-11, BR-12 and BR-15 each have tests named with the ID (Test plan). TST-11 unchanged: the lifecycle table already has both transitions. Concurrency tests assert on outcome sets (R10). API tests cover `200`, `400`, `401`, `403`, `404`, `409`, `422` and a repeated key (testing.md section 5) |
| VIII. Observable, One Config | Pass | No new configuration. The 2,000-character limit is a constant, as the note limit is |
| IX. One Vocabulary | Pass | `reject`, `SiteSupervisor`, `Foreman`, `DailyReport`, `approvedProgress`, "reason" (glossary, Transition): glossary terms |
| X. Deliberate Simplicity | Pass | No new dependency, table, port method or mechanism. The existing `save` is reused instead of a `saveRejection` (R4) |

Re-check after Phase 1 design: unchanged, all pass. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/004-reject-and-resubmit/
├── spec.md
├── plan.md                 this file
├── research.md             Phase 0: decisions R1 to R12
├── data-model.md           Phase 1: domain changes, the migration, state diagram, walkthrough versions
├── quickstart.md           Phase 1: validation run, the whole PRD example
├── contracts/
│   └── reject-report.md    POST /reports/:reportId/reject, and what follows a rejection
├── checklists/requirements.md
└── tasks.md                Phase 2 (/speckit-tasks)
```

The report response, the request-key behavior, save and submit are feature 002's
[contracts](../002-draft-and-submit/contracts/), unchanged. Approval is feature 003's
[approve-report.md](../003-approve-report/contracts/approve-report.md), unchanged.

### Source Code (repository root)

`+` new, `~` changed.

```text
prisma/migrations/
└── + <timestamp>_add_transition_reason_checks/migration.sql   two CHECKs on report_transitions (R5)

src/
├── ~ app.ts                                 AppDependencies gains rejectReport; passed to reportRoutes
├── ~ main.ts                                wires RejectReport(reports, worksites, clock)
└── modules/reporting/
    ├── domain/
    │   └── ~ daily-report.ts                private assertDecidableBy (BR-12, R2); assertCanApprove uses it;
    │                                        assertCanReject and reject (BR-10, BR-8, BR-11) (R3)
    ├── application/
    │   └── + reject-report.ts               RejectReport (UC-4, R1)
    ├── interface/
    │   ├── ~ report.schemas.ts              rejectReportBody, REASON_MAX_LENGTH (R6)
    │   └── ~ report.routes.ts               POST /reports/:reportId/reject
    └── ~ index.ts                           exports RejectReport

test/
├── support/
│   ├── ~ test-app.ts                        wires RejectReport like main.ts
│   └── ~ townhouse.ts                       Caller.reject (R11)
├── unit/modules/reporting/
│   ├── domain/~ daily-report.test.ts        describe("reject"): BR-8, BR-10, BR-11, BR-12, FR-007, FR-008;
│   │                                        BR-6 edit and submit of a REJECTED report
│   └── application/+ reject-report.test.ts
├── integration/
│   ├── ~ daily-report.repository.int.test.ts   BR-11 a rejection's reason is stored; BR-15 save (reject)
│   │                                           against saveApproval from one version
│   └── ~ reporting-schema.int.test.ts       BR-8 and FR-003: the two CHECKs refuse bad rows
└── api/
    ├── + reject-report.api.test.ts
    ├── ~ concurrency.api.test.ts            approve against reject; two rejections
    ├── ~ permissions.api.test.ts            Foreman and another Site Supervisor cannot reject
    └── ~ report-flow.api.test.ts            the PRD example row by row; the 21 November refusals

Other:
├── ~ http/report-flow.http                  reordered to follow the PRD rows; Henry's report end to end (R8)
├── ~ README.md                              "Run it": the walkthrough runs the whole PRD example
└── ~ docs/engineering/implementation-plan.md   step 4, as listed below
```

`src/modules/worksite/`, `src/modules/reporting/infrastructure/` and `schema.prisma` do not change.
No fake changes: `InMemoryDailyReportRepository.save` already stores status and transitions.

**Structure Decision**: the existing modular monolith (architecture.md, section 3), with the
`reporting` layout of features 002 and 003. Rejection adds one use case file and extends the
aggregate and its routes. `worksite` gains no dependency on `reporting` (ARC-04).

### Configuration files touched

None. `tsconfig.json`, `biome.json`, `.dependency-cruiser.cjs`, the CI workflow,
`docker-compose.yml` and `.env.example` are not changed.

### Documents updated in the same commit series

| Document | Change |
| --- | --- |
| `docs/engineering/implementation-plan.md` step 4 | New `reporting/infrastructure` row: no new repository method, rejection uses `save` (R4); migration with the two `CHECK`s (R5). Tests rows: `BR-8` refuses a missing, empty or blank reason, after permission, version and status; `BR-12` and a `DRAFT` get `403 REPORT_REJECTION_FORBIDDEN`; API: approve against reject, the loser always `409 REPORT_VERSION_CONFLICT`; a reason over 2,000 characters is a `400`. Questions to settle: both answered (2,000 characters; the reason is in every report response) |
| `http/report-flow.http` | Reordered by PRD row; Henry drafts and submits before Linda's first approval; rejection, Henry's view, edit, resubmission, approval; townhouse after each row (R8) |
| `README.md` "Run it" | The walkthrough creates Mark's and Henry's reports for 20 November and runs the whole PRD example (FR-025) |

`docs/product/` needs no change. UC-4's "Applies" line and P6 are stated in the spec and the
implementation plan, for the product owner.

## Test plan

Each row becomes at least one task. The build order follows the constitution: domain, use case,
repository and migration, route. Rule IDs at the start of a row are the start of the test name
(TST-01).

| Layer | Test | Covers |
| --- | --- | --- |
| Unit | `BR-12` `reject` refuses a Foreman (including the author) and the Site Supervisor of another worksite with `REPORT_REJECTION_FORBIDDEN` | US3-1 to US3-3; FR-009 |
| Unit | `reject` refuses the worksite's Site Supervisor on a `DRAFT` with the same code, message and details as the BR-12 refusal | US3-6; FR-008 |
| Unit | `BR-12` `assertCanApprove` still refuses with `REPORT_APPROVAL_FORBIDDEN` after the refactor (existing 003 tests, unchanged) | R2 |
| Unit | `BR-10` an `APPROVED` report cannot be rejected: `INVALID_STATUS_TRANSITION`, `from` `APPROVED`, `to` `REJECTED` | US3-4; FR-008 |
| Unit | `reject` refuses a `REJECTED` report, stating the status | US3-5; FR-008 |
| Unit | `BR-8` `reject` refuses a `null`, empty, spaces-only and tabs-and-newlines reason with `REJECTION_REASON_REQUIRED` | US1-3; FR-002 |
| Unit | `BR-8` the reason is checked after permission and status: a Foreman with no reason gets `403`; an `APPROVED` report with no reason gets `INVALID_STATUS_TRANSITION` | US3-8; FR-021 |
| Unit | `BR-11` rejecting records one transition `SUBMITTED → REJECTED`, actor, time from the clock, the reason exactly as given (leading and trailing spaces kept); items and note unchanged | US1-1; FR-004, FR-006; Clarifications Q4 |
| Unit | `reject` accepts a report on a `CLOSED` worksite, one whose task is now assigned to another Foreman, and one whose task's approved progress is above its figure | US1-4 to US1-6; FR-007 |
| Unit | `BR-6` the author can edit a `REJECTED` report, which stays `REJECTED`; another Foreman and a Site Supervisor cannot | US2-2, US2-5; FR-012 |
| Unit | `BR-6` the author can submit a `REJECTED` report, edited or not, recording `REJECTED → SUBMITTED` after the rejection | US2-3, US2-4; FR-013, FR-014 |
| Unit | `RejectReport`: unknown report → `REPORT_NOT_FOUND` | US3-7; FR-010 |
| Unit | `RejectReport`: permission before version (a Foreman with a stale version gets `403`), version before status (a stale version on an `APPROVED` report gets `REPORT_VERSION_CONFLICT`), status before reason | FR-021; R1 |
| Unit | `BR-15` `RejectReport` with a stale version throws `REPORT_VERSION_CONFLICT` with the current version and writes nothing | US4-4; FR-018 |
| Unit | `RejectReport` changes no task (fakes) | FR-006, FR-015 |
| Integration | `BR-11` `save` of a rejected report stores the transition with its reason, version + 1, items' `updated_at` unchanged | FR-004, FR-005, FR-006 |
| Integration | `BR-15` `save` (rejection) and `saveApproval` from the same version at once: one succeeds, one `REPORT_VERSION_CONFLICT`; one new transition; task progress matches the winner | US4-1, US4-2; FR-019; SC-003 |
| Integration | `BR-8` the database refuses a `REJECTED` transition with a `NULL`, empty or whitespace-only reason, and any transition with a reason over 2,000 characters | FR-002, FR-003; SC-005; R5 |
| API | `reject-report.api.test.ts`: `200` with `REJECTED`, new `version`, the transition with its reason; the townhouse unchanged | US1-1, US1-2 |
| API | `400` for a non-UUID ID, a missing `version`, a numeric `reason`, a 2,001-character `reason` (2,000 accepted), an unknown field, a query parameter, a missing `Idempotency-Key`; `401` with no actor headers | US4-8; FR-003, FR-016 |
| API | `422 REJECTION_REASON_REQUIRED` for a missing, `null`, empty and blank reason | US1-3; FR-002 |
| API | `403 REPORT_REJECTION_FORBIDDEN` for Henry, Mark, a Site Supervisor of another worksite, and Linda on a `DRAFT`; `404` for an unknown report | US3; SC-004 |
| API | `409` stale version; `409 INVALID_STATUS_TRANSITION` for `APPROVED` and `REJECTED` | US3-4, US3-5, US4-4 |
| API | `200` for a closed worksite, a reassigned task, and a report that approval refuses with `REPORT_PROGRESS_OUTDATED` | US1-4 to US1-6 |
| API | `BR-14` a repeated `Idempotency-Key` replays the response with one transition; the same key with another reason → `422 IDEMPOTENCY_KEY_REUSED`; a refused rejection releases its key | US4-6, US4-7; SC-007 |
| API | `BR-6` after a rejection, Henry's save keeps `REJECTED` and its response carries the reason; his submission records `REJECTED → SUBMITTED`; the rejection is still in the history | US2-1 to US2-4; FR-011; SC-006 |
| API | A report rejected twice keeps both reasons, oldest first | US2-8; FR-014 |
| API | `concurrency.api.test.ts`: approve and reject of one report from one version → one `200`, one `409 REPORT_VERSION_CONFLICT`, never `INVALID_STATUS_TRANSITION`; Install electrical matches the winner. Two rejections → one `200`, one `409` | US4-1 to US4-3; SC-003 |
| API | `permissions.api.test.ts`: a Foreman cannot reject; a Site Supervisor of another worksite cannot reject; a Foreman or a Site Supervisor cannot edit or submit someone else's rejected report | UC-4; US2-5 |
| API | `report-flow.api.test.ts`: the PRD example row by row: both submit (40/0), Linda approves Mark (55/0), Linda rejects Henry with the PRD reason (55/0), Henry edits to 5% and resubmits (55/0), Linda approves (55/5); Henry's report has four transitions | US5-1 to US5-4; FR-022; SC-001, SC-002 |
| API | `report-flow.api.test.ts`: from that end state, Mark cannot submit walls below 55% or report Install electrical for 21 November | US5-5 |
| API | PRD implementation goals: mapped to existing and new tests in research R9 | FR-023; SC-008 |
| Manual | [quickstart.md](./quickstart.md) sections 2 to 7, and `http/report-flow.http` from a clean stack | FR-024, FR-025; SC-009 |

## Complexity Tracking

No constitution violations. Nothing to justify.
