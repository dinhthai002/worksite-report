# Implementation Plan: Approve a daily report

**Branch**: `main` (the repository works on `main`; the feature is identified by `.specify/feature.json`) | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-approve-report/spec.md`

## Summary

UC-3 Approve a report: one endpoint, one use case, two domain methods, one repository method. No
new table or migration.

- **Domain**: `DailyReport.assertCanApprove` (BR-12; a `DRAFT` gets the same `403`, so a Site
  Supervisor learns nothing about drafts) and `DailyReport.approve` (BR-10 through the existing
  transition table, BR-5 against every item at once, BR-11 transition). A shared
  `progressOutdated` factory builds the one BR-5 error that lists every offending task (research
  R2, R3).
- **Order of checks**: existence, permission, version, status, progress. The loser of two
  simultaneous approvals therefore always gets `REPORT_VERSION_CONFLICT` (R1; Clarifications Q3).
- **The approval write (ADR 0004)**: `saveApproval` runs one transaction: the report conditional on
  `version` and `status = SUBMITTED`; each task raised only when below the reported progress, in
  ascending task ID order so concurrent approvals cannot deadlock, and the tasks not raised checked
  not to be above it; the transition. Any failed condition rolls back everything (BR-9, BR-15). A
  task already at the reported value is not written, so it keeps its place in the worksite's list
  (R4, R5; Clarifications).
- **Request**: `{ "version": n }` and nothing else; a comment is a `400` (R6; Clarifications Q4).

Approach and alternatives: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 6 (`strict`), Node.js 22

**Primary Dependencies**: Express 5, Zod 4, Prisma 6.19, pino. No new dependency

**Storage**: PostgreSQL 17. No schema change. Approval writes `daily_reports`, `tasks` and
`report_transitions` in one transaction

**Testing**: Jest 30 with ts-jest; Testcontainers (`postgres:17.11`) for integration and API tests;
supertest; `FixedClock`; in-memory fakes for unit tests

**Target Platform**: Linux container (Docker Compose: `db`, `migrate`, `api`)

**Project Type**: Web service (modular monolith backend)

**Performance Goals**: none beyond normal interactive use. A report holds at most one Foreman's
tasks in one worksite; approval runs one conditional update per item in one transaction

**Constraints**: constitution v1.1.0; ADR 0004 (the only cross-module write); every report write
conditional on `version` (DB-03); feature 002 must be complete first (see Prerequisite)

**Scale/Scope**: 1 endpoint, 1 use case, 2 aggregate methods, 1 repository method, 2 new error
codes

No unknowns remain: the spec's four clarifications, ADR 0004 and the implementation plan's
section 3 cover every open point.

### Prerequisite: finish feature 002

Feature 002's save, submit and request-key work is committed (through 38e7f38), with the
submit-order fix of research R10 and the product-owner changes it waited for. Its tasks T045 to
T055 are still open: `GetReport`, `GET /reports/:reportId`, the `http/report-flow.http`
walkthrough, the documentation updates and the final checks. This feature depends on
them: US1-7 views an approved report, FR-021 continues 002's walkthrough, and quickstart section 2
runs 002's quickstart. Complete and commit feature 002 before starting this feature's tasks.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v1.1.0, before research and again after design.

| Principle | Result | How the design complies |
| --- | --- | --- |
| I. Documents First | Pass, with a stated conflict | The spec governs. UC-3's "Applies" line now lists BR-11 and BR-14 (`docs(product)` 93912c8), as the spec applies them. UC-3's approve-against-reject verification (moved to 004) is stated in the spec, not resolved silently. `docs/product/` and `docs/adr/` are not edited. The draft refusal is identical to the BR-12 refusal, as the spec's FR-009 now states (R2). ADR 0004's task condition `approved_progress <= reported_progress` is refined, not changed: the update uses `<` so an equal task is not written (spec FR-002), and a read of the tasks not raised fails the approval when one is above, so the same tasks are accepted (R4). Stated here for the reviewer |
| II. A Person Approves Every Step | Pass | This plan awaits review before `/speckit-tasks` |
| III. Rules in the Domain, Boundaries | Pass | BR-5, BR-10, BR-12 and FR-009 are in `DailyReport`, each citing its ID. The repository's conditional updates are the concurrency guard ADR 0004 names, and reuse the domain's error factory, not a second copy of the rule (R3). `reporting` reads `Worksite` through `worksite/index.ts` only and writes `tasks` only in `reporting/infrastructure` (ADR 0004, R7). One use case in `approve-report.ts`; the route parses, calls, maps. Time from `Clock` |
| IV. Types, Naming, Comments | Pass | `approve-report.ts` exports `ApproveReport` (NAM-04). `OutdatedItem` uses branded `TaskId` and `Progress`. No new union, so no new `switch` |
| V. Errors and HTTP Contract | Pass | Two new stable codes, `REPORT_APPROVAL_FORBIDDEN` (`ForbiddenError`, `403`) and `REPORT_PROGRESS_OUTDATED` (`RuleViolationError`, `422`); the rest reused (R1). `error-handler.ts` unchanged. Body and path through `withValidInput`; `Idempotency-Key` by the existing middleware; `version` in, `version` out ([contracts/approve-report.md](./contracts/approve-report.md)) |
| VI. Database Guards Integrity | Pass | No migration. The approval is one `$transaction` across two aggregates, as ADR 0004 records (DB-04). Report write conditional on `version` (DB-03). Task writes conditional on approved progress, so concurrency cannot lower it. The existing `CHECK` on `approved_progress` and the append-only trigger still apply |
| VII. Rules Traceable and Tested | Pass | BR-5, BR-9, BR-10, BR-12 and BR-15 each have unit or integration tests named with the ID (Test plan). TST-11 unchanged: `SUBMITTED → APPROVED` is already in the table. Concurrency tests assert on outcome sets (R9). API tests cover `200`, `400`, `401`, `403`, `404`, `409`, `422` and a repeated key (testing.md section 5) |
| VIII. Observable, One Config | Pass | No new configuration. The request log line already carries actor and request IDs |
| IX. One Vocabulary | Pass | `approve`, `approvedProgress`, `reportedProgress`, `SiteSupervisor` as `Role.SITE_SUPERVISOR`, `DailyReport`: glossary terms. `OutdatedItem` is a value inside one error's details, not a new domain concept |
| X. Deliberate Simplicity | Pass | No new dependency, table, port type or mechanism. One new port method (R5) |

Re-check after Phase 1 design: unchanged, all pass. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/003-approve-report/
├── spec.md
├── plan.md                 this file
├── research.md             Phase 0: decisions R1 to R10
├── data-model.md           Phase 1: domain changes, what the approval writes, state diagram
├── quickstart.md           Phase 1: validation run
├── contracts/
│   └── approve-report.md   POST /reports/:reportId/approve
├── checklists/requirements.md
└── tasks.md                Phase 2 (/speckit-tasks)
```

The report response and the request-key behavior are feature 002's
[report-view.md](../002-draft-and-submit/contracts/report-view.md) and
[idempotency.md](../002-draft-and-submit/contracts/idempotency.md), unchanged.

### Source Code (repository root)

`+` new, `~` changed.

```text
src/
├── ~ app.ts                                 AppDependencies gains approveReport; passed to reportRoutes
├── ~ main.ts                                wires ApproveReport(reports, worksites, clock)
└── modules/reporting/
    ├── domain/
    │   ├── ~ daily-report.ts                OutdatedItem, progressOutdated (R3); DailyReport.assertCanApprove
    │   │                                    (BR-12, FR-009, R2) and approve (BR-10, BR-5, BR-11)
    │   └── ~ daily-report.repository.ts     saveApproval (R5)
    ├── application/
    │   └── + approve-report.ts              ApproveReport (UC-3, R1)
    ├── infrastructure/
    │   └── ~ prisma-daily-report.repository.ts  saveApproval: one transaction, report then tasks in
    │                                            task ID order, then transition (ADR 0004, R4)
    ├── interface/
    │   ├── ~ report.schemas.ts              approveReportBody (R6)
    │   └── ~ report.routes.ts               POST /reports/:reportId/approve
    └── ~ index.ts                           exports ApproveReport

test/
├── support/
│   └── ~ test-app.ts                        wires ApproveReport like main.ts
├── fakes/
│   ├── ~ in-memory-daily-report.repository.ts  saveApproval, against an InMemoryWorksiteRepository
│   └── ~ in-memory-worksite.repository.ts   replace(worksite), test-only (R8)
├── unit/modules/reporting/
│   ├── domain/~ daily-report.test.ts        describe("approve"): BR-10, BR-12, BR-5, BR-11, FR-008, FR-009
│   └── application/+ approve-report.test.ts
├── integration/
│   └── ~ daily-report.repository.int.test.ts   describe("saveApproval"): BR-9, BR-15, BR-5, FR-011
└── api/
    ├── + approve-report.api.test.ts
    ├── ~ concurrency.api.test.ts            two approvals of one report
    ├── ~ permissions.api.test.ts            Foreman and another Site Supervisor cannot approve
    └── ~ report-flow.api.test.ts            continues to Linda's approval

Other:
├── ~ http/report-flow.http                  Linda approves Mark's report; Linda views the townhouse
└── ~ docs/engineering/implementation-plan.md   step 3, as listed below
```

`src/modules/worksite/` does not change (R7). No file under `prisma/` changes.

**Structure Decision**: the existing modular monolith (architecture.md, section 3), with the
`reporting` layout of feature 002 (002 R19). Approval adds one use case file and extends the
aggregate, its port, its Prisma repository and its routes. `worksite` gains no dependency on
`reporting` (ARC-04).

### Configuration files touched

None. `tsconfig.json`, `biome.json`, `.dependency-cruiser.cjs`, the CI workflow,
`docker-compose.yml` and `.env.example` are not changed.

### Documents updated in the same commit series

| Document | Change |
| --- | --- |
| `docs/engineering/implementation-plan.md` step 3 | `worksite/index.ts` row: already satisfied by feature 002, no change (R7). `reporting/infrastructure` row: task updates in ascending task ID order (R4). Tests rows: the BR-5 refusal lists every task; a `DRAFT` gets `403`; the concurrency loser always gets `409 REPORT_VERSION_CONFLICT`; a body with a comment gets `400` |
| `http/report-flow.http` | Linda approves Mark's report from version 3; Linda views the townhouse (walls 55, electrical 0) |

`docs/product/` needs no change for this feature: UC-3's "Applies" line already lists every rule
it applies (93912c8).

## Test plan

Each row becomes at least one task. The build order follows the constitution: domain, use case,
repository, route. Rule IDs at the start of a row are the start of the test name (TST-01).

| Layer | Test | Covers |
| --- | --- | --- |
| Unit | `BR-12` `approve` rejects a Foreman (including the author) and the Site Supervisor of another worksite with `REPORT_APPROVAL_FORBIDDEN` | US3-1 to US3-3; FR-012 |
| Unit | `approve` rejects the worksite's Site Supervisor on a `DRAFT` with the same code, message and details as the BR-12 refusal | US3-6; FR-009; R2 |
| Unit | `BR-10` an `APPROVED` report cannot be approved again (`INVALID_STATUS_TRANSITION`, `from` `APPROVED`), edited (`REPORT_NOT_EDITABLE`) or submitted (`INVALID_STATUS_TRANSITION`) | US3-4, US3-5; FR-014 |
| Unit | `approve` rejects a `REJECTED` report, stating the status | US3-7; FR-009 |
| Unit | `BR-5` `approve` rejects when a task's approved progress is above the reported progress, naming the task and both figures | US2-1; FR-006 |
| Unit | `BR-5` with two stale items, the refusal lists both, in item order | US2-4; FR-006; SC-007 |
| Unit | `BR-5` reported progress equal to approved progress is accepted | US1-4 |
| Unit | `BR-11` approving records one transition `SUBMITTED → APPROVED`, actor, time from the clock, reason null; items and note unchanged | US1-1; FR-003, FR-005 |
| Unit | `approve` accepts a report on a `CLOSED` worksite, and one whose task is now assigned to another Foreman | US1-5, US1-6; FR-008 |
| Unit | `ApproveReport`: unknown report → `REPORT_NOT_FOUND` | US3-8; FR-013 |
| Unit | `ApproveReport`: checks permission before version (a Foreman with a stale version gets `403`), and version before status (a stale version on an `APPROVED` report gets `REPORT_VERSION_CONFLICT`) | FR-020; R1 |
| Unit | `BR-15` `ApproveReport` with a stale version throws `REPORT_VERSION_CONFLICT` with the current version, and writes nothing | US4-2; FR-017 |
| Unit | `BR-9` `ApproveReport` sets every item's task to its reported progress and leaves other tasks unchanged (fakes) | US1-2, US1-3; FR-002 |
| Integration | `BR-9` `saveApproval` writes status, version + 1, the transition and every item's task; other tasks unchanged | FR-002, FR-004, FR-010 |
| Integration | `BR-9` a task reported at its current approved progress is not written: `approved_progress` and `updated_at` unchanged | US1-4; FR-002 |
| Integration | `BR-9` `saveApproval` where one of two tasks is already above the report: throws `REPORT_PROGRESS_OUTDATED` naming it; the report stays `SUBMITTED` at the same version, no transition, and neither task changes (UC-3 acceptance) | US2-3, US2-5; SC-002 |
| Integration | `BR-15` two `saveApproval` calls from the same version at once: one succeeds, one `REPORT_VERSION_CONFLICT`; exactly one approval transition | US4-1; FR-018; SC-003 |
| Integration | `BR-5` reports approved out of date order: after the 20th at 60% is approved, approving the 19th at 40% fails and the task stays 60% | US2-1; FR-007 |
| Integration | `BR-5` two reports sharing a task, at 50% and 60%, approved at once: the task ends at 60%, never 50% | US4-7; FR-011; SC-006 |
| Integration | Two reports sharing two tasks approved at once: no deadlock; outcomes as above | R4, R9 |
| API | `approve-report.api.test.ts`: `200` with `APPROVED`, new `version`, the transition; the townhouse then shows walls 55, foundation 100, electrical 0 | US1-1, US1-2; SC-001 |
| API | `400` for a non-UUID ID, a missing `version`, a `comment` field, a query parameter, a missing `Idempotency-Key`; `401` with no actor headers | US4-5; FR-015 |
| API | `403 REPORT_APPROVAL_FORBIDDEN` for Mark, Henry, a Site Supervisor of another worksite, and Linda on a `DRAFT`; `404` for an unknown report | US3; SC-004 |
| API | `409` stale version; `409 INVALID_STATUS_TRANSITION` for `APPROVED` and `REJECTED`; `422 REPORT_PROGRESS_OUTDATED` with `details.tasks` | US2, US3, US4 |
| API | `200` for a closed worksite and for a reassigned task | US1-5, US1-6 |
| API | `BR-14` a repeated `Idempotency-Key` replays the response with one transition; the same key with another version → `422 IDEMPOTENCY_KEY_REUSED`; a refused approval releases its key | US4-3, US4-4, US4-6; SC-005 |
| API | `concurrency.api.test.ts`: two approvals of one report from one version → one `200`, one `409 REPORT_VERSION_CONFLICT`, never `INVALID_STATUS_TRANSITION` | US4-1; Clarifications Q3 |
| API | `permissions.api.test.ts`: a Foreman cannot approve; a Site Supervisor of another worksite cannot approve | UC-3 acceptance |
| API | `report-flow.api.test.ts`: Mark drafts, edits, submits; Linda approves; walls 55, electrical 0 | FR-021; implementation plan exit criterion |
| Manual | [quickstart.md](./quickstart.md) sections 2 to 7, and `http/report-flow.http` | FR-021; SC-008 |

## Complexity Tracking

No constitution violations. Nothing to justify.
