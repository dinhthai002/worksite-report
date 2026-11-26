# Research: Approve a daily report

Phase 0 of [plan.md](./plan.md). The spec has no open questions (four were settled in
`/speckit-clarify`), the stack is fixed by the constitution, and ADR 0004 fixes the shape of the
approval write. Each entry below is a design decision. Format: decision, rationale, alternatives.
Feature 002's research is referred to as "002 R*n*".

## R1. Order of checks

**Decision.** `ApproveReport` checks in the order of the spec's FR-020:

| Step | Check | Where | Error |
| --- | --- | --- | --- |
| 1 | Identity | actor middleware (feature 001) | `401` |
| 2 | Request key present and well formed; claim | idempotency middleware (002 R9) | `400`, `409`, `422` |
| 3 | Path and body shape; `version` present; no other field | `withValidInput`, `approveReportBody` | `400` |
| 4 | Report exists | use case | `404 REPORT_NOT_FOUND` |
| 5 | Caller may approve this report: BR-12, and a `DRAFT` is answered the same way | `DailyReport.assertCanApprove(actor, worksite)` | `403 REPORT_APPROVAL_FORBIDDEN` |
| 6 | Stated version is current | use case, early; repository, conditional write (R4) | `409 REPORT_VERSION_CONFLICT` |
| 7 | Status is `SUBMITTED` (BR-10) | `assertTransition(status, APPROVED)` in `DailyReport.approve` | `409 INVALID_STATUS_TRANSITION` |
| 8 | No task's approved progress is above the report's figure (BR-5) | `DailyReport.approve`; repository guard (R3, R4) | `422 REPORT_PROGRESS_OUTDATED` |

The use case loads the worksite between steps 4 and 5, because BR-12 needs its Site Supervisor.

**Rationale.** Permission before version means a Foreman or another Site Supervisor learns nothing
about the report, not even that it changed (spec, Assumptions). Version before status makes the
loser of a race always get `REPORT_VERSION_CONFLICT` (spec, Clarifications Q3): the winner changed
both status and version, so the version check catches it first. There is no role check before the
existence check, unlike save and submit in 002: FR-020 puts existence first, and the single
permission check of step 5 covers role and worksite together.

**Alternatives.** A role check before loading the report, as `SubmitReport` does: answers a
Foreman faster, but gives a Foreman `403` and a Site Supervisor `404` for the same unknown ID,
which is not the order FR-020 states.

## R2. One forbidden answer for BR-12 and for a draft

**Decision.** `DailyReport.assertCanApprove(actor, worksite)` allows only an actor whose role is
`SITE_SUPERVISOR` and whose ID is `worksite.supervisorId`, for a report whose status is not
`DRAFT`. Every other case throws the same error, with the same code, message and details:

```text
ForbiddenError("REPORT_APPROVAL_FORBIDDEN",
  "You may not approve this report. Only the site supervisor of its worksite may approve it, once it is submitted.",
  { reportId })
```

**Rationale.** Clarification Q2: approving a `DRAFT` is refused as not permitted, so that a Site
Supervisor learns nothing about drafts from any action. If the draft case had its own code or
message, Linda could tell a draft on her worksite from a report she does not supervise. One answer
for all three cases hides that, and the message is true in each case.

The spec's FR-009 asks for exactly this: the draft refusal is identical to FR-012's (spec,
Clarifications).

**Alternatives.** Reusing `REPORT_VIEW_FORBIDDEN`: a code that says "view" on an approve request.
A separate `NOT_WORKSITE_SUPERVISOR` for BR-12: false for Linda on her own draft, and it would make
the draft case distinguishable.

Feature 004 adds rejection; it can reuse this check with its own code, or generalize the code to
"decide". That choice belongs to 004.

## R3. BR-5 at approval: every offending task, implemented once

**Decision.** `reporting/domain/daily-report.ts` gains:

```ts
export interface OutdatedItem {
  readonly taskId: TaskId;
  readonly taskName: string;
  readonly reportedProgress: Progress;
  readonly approvedProgress: Progress;
}
export function progressOutdated(items: readonly OutdatedItem[]): RuleViolationError
```

`DailyReport.approve` compares every item with its task's current approved progress (BR-5), and if
any is below, throws `progressOutdated(all of them)`. The message lists each task, for example:

```text
This report cannot be approved: approved progress is already above it for 1 task.
"Build ground-floor walls": reported 40%, approved 60%. Reject the report so its author can update it.
```

`details` is `{ tasks: OutdatedItem[] }`, in the order of the report's items.

The repository's guard (R4) throws the same error through the same factory when the conditional
task update finds a task that another approval has raised in the meantime.

**Rationale.** Clarification Q1: every offending task, with both figures. ARC-05: the comparison
is implemented once, in the domain; the repository's conditional update is the concurrency guard
ADR 0004 describes, not a second copy of the rule, and it reuses the domain's factory so the client
sees one code and one shape.

The code is new, not 002's `PROGRESS_BELOW_APPROVED`, because the details differ (a list, not one
task) and the remedy differs (the Site Supervisor rejects; the Foreman does not fix and retry).
A client that switches on the code can show the right next step.

**Alternatives.** Reusing `PROGRESS_BELOW_APPROVED` with a list in `details`: one code with two
shapes depending on the endpoint. Stopping at the first task, as submit does: refused in clarify.

## R4. The approval write (ADR 0004)

**Decision.** `DailyReportRepository.saveApproval(report, expectedVersion)` runs one
`$transaction` (DB-04):

1. `UPDATE daily_reports SET status = 'APPROVED', version = version + 1 WHERE id = $id AND
   version = $expected AND status = 'SUBMITTED'` (Prisma `updateMany`). Zero rows: throw
   `REPORT_VERSION_CONFLICT` with the current version, as `save` does (002 R10).
2. For each item, **in ascending `task_id` order**: `UPDATE tasks SET approved_progress = $reported
   WHERE id = $task AND worksite_id = $worksite AND approved_progress < $reported` (Prisma
   `updateMany`). This raises a task and never writes one already at the reported value
   (Clarifications: such a task does not count as changed). Collect every item whose update matched
   zero rows.
3. If any were collected: read their tasks' names and current approved progress in the same
   transaction. A task equal to the item's figure is fine. If any task is above it, throw
   `progressOutdated(…)` (R3) with those tasks. The transaction rolls back: the report stays
   `SUBMITTED` with its version, and no task changes (BR-9).
4. Insert the new transition (BR-11), as `save` does.
5. Return the report reloaded, with its new version and transitions.

The domain object passed in is already `APPROVED`, with the transition appended, built by
`DailyReport.approve`. The repository does not decide anything; it writes what the aggregate
decided, under conditions that make a concurrent change fail instead of being overwritten.

**Rationale.**

- **ADR 0004** prescribes one transaction owned by the reporting repository, the report conditional
  on `version` and `status = SUBMITTED`, each task conditional on `approved_progress <=
  reported_progress`, any failed condition rolling back everything. This design keeps all of that
  and splits the task condition in two: `<` in the update, so an equal task is not written, and a
  read of the tasks not raised, which fails the approval when one is above the reported figure.
  Together they accept exactly the tasks `<=` accepts. ADR 0004 is not edited (constitution I);
  this refinement is recorded here and in the plan's Constitution Check.
- **Concurrency.** PostgreSQL runs at `READ COMMITTED`. An `UPDATE` that meets a row locked by
  another transaction waits, then re-evaluates its `WHERE` against the committed row. So of two
  approvals of the same report, the second's step 1 matches zero rows once the first commits
  (FR-018). Of two approvals of different reports that share a task, the second's step 2 sees the
  first's value: if it is now above the second's figure, the second rolls back (FR-007, FR-011).
  A task that step 2 does not raise is not locked. That is safe: this approval writes nothing to
  it, and another approval can only raise it. If step 3 reads the raised value, this approval rolls
  back; if it reads the old one, this approval is ordered first and the other's raise follows.
  Either way approved progress never decreases.
- **Deadlocks.** Two approvals that share two tasks and lock them in opposite orders would
  deadlock, and PostgreSQL would abort one with an error that becomes a `500`. Updating in
  ascending `task_id` order makes every transaction take task locks in the same order, so it cannot
  happen. Each report locks only its own report row first, so report rows cannot form a cycle.
- **Collecting before throwing** gives FR-006's full list on the concurrency path too, at the cost
  of running the remaining updates, which the rollback discards.
- **`worksite_id` in the task condition** keeps the write inside the report's worksite, even though
  BR-4 already guarantees it. It costs nothing and makes the cross-module write narrower.

**Equal figures.** A task whose reported progress equals its approved progress is not written, so
its `updated_at` stays and it keeps its place in the worksite view, which lists tasks last changed
first (feature 001, FR-010; spec FR-002, Clarifications). The cost is the read in step 3, which
runs only for tasks that were not raised.

**Alternatives.** `SELECT … FOR UPDATE` on all the report's tasks first, then compare in code: also
correct, but it is a check-then-write in application code, and ADR 0004 chose the conditional
update. A serializable transaction with retry: retries are what TST-12 and the constitution's
simplicity principle steer away from.

## R5. A separate port method for approval

**Decision.** `DailyReportRepository` gains `saveApproval(report, expectedVersion): Promise<DailyReport>`.
`save` is unchanged.

**Rationale.** Approval writes another module's table under extra conditions (ADR 0004: "the only
place where reporting infrastructure writes a table owned by worksite"). A method of its own makes
that write visible in the port, and keeps `save` free of a branch on the target status. The fake
(`InMemoryDailyReportRepository`) implements it against an `InMemoryWorksiteRepository` it is given,
so unit tests see approved progress change.

**Alternatives.** `save` detecting `status === APPROVED`: one method doing two kinds of write, with
the cross-module write hidden behind a status check. A worksite-side port such as
`WorksiteRepository.setApprovedProgress`: two repositories in one transaction needs a unit-of-work
port, which ADR 0004 rejected.

## R6. Request body: the version and nothing else

**Decision.** `report.schemas.ts` adds `approveReportBody = z.strictObject({ version:
z.number().int().min(1) })`. A body with `reason`, `comment` or any other field is a `400
VALIDATION_FAILED` (spec, Clarifications Q4; FR-015). The path reuses `reportParams`.

**Rationale.** Strict objects are the project's default (feature 001, `withValidInput`). Declaring
a body of its own, instead of reusing `submitReportBody`, keeps each contract readable on its own
and lets 004's reject body add `reason` without touching approval.

## R7. What the worksite module exports

**Decision.** No change to `src/modules/worksite/index.ts`. `reporting` already gets `Worksite` and
`WorksiteRepository` through it (002 R2), and `Worksite` already exposes `supervisorId` and each
task's `approvedProgress`, which is what the implementation plan's Step 3 asks for. Approval writes
`tasks` only in `reporting/infrastructure`, through Prisma, never by importing `worksite` code
(ADR 0004; ARC-03).

**Rationale.** The plan's Step 3 row "`worksite/index.ts` exports what reporting needs to read" is
already satisfied by feature 002. Writing through the worksite module would need a shared
transaction (R5, alternatives).

## R8. Test data and fixtures

**Decision.**

- **Another Site Supervisor and worksite** (Sam, US3-3): `test/support/database.ts` already inserts
  users and worksites for integration and API tests; tests add Sam and a second worksite with
  those helpers. Unit tests build them with `worksite.builder.ts`.
- **A task already above the report** (US2): set `tasks.approved_progress` directly after the
  report is submitted, or approve another report first (US2-1, the plan's out-of-order test).
- **A closed worksite, a reassigned task, a `REJECTED` report**: as in 002 R17, prepared directly.
- **Two reports sharing a task**: Mark's reports for two work dates, both submitted.
- `test/fakes/in-memory-worksite.repository.ts` gains a test-only `replace(worksite)` so the fake
  report repository can store a worksite with new approved progress.

## R9. Concurrency tests that cannot flake

**Decision.** All use `Promise.allSettled` and assert on the set of outcomes (testing.md section 4;
002 R18).

- **Two approvals of one report from one version** (integration on the repository, and API): always
  one success and one `REPORT_VERSION_CONFLICT`, whichever wins (R4, step 1). Exactly one approval
  transition. The API test also asserts the loser's code is never `INVALID_STATUS_TRANSITION`
  (Clarifications Q3).
- **Two reports sharing a task, at 50% and 60%, approved together** (integration): the task ends at
  60%; the 60% report is `APPROVED`; the 50% report is either `APPROVED` (it went first) or
  `SUBMITTED` with `REPORT_PROGRESS_OUTDATED`. Never 50% at the end (FR-011, SC-006).
- **Two reports sharing two tasks, approved together** (integration): neither request fails with
  anything other than the outcomes above; in particular no deadlock error (R4).

**Rationale.** Each asserts only what the conditional updates guarantee, so the result does not
depend on timing (TST-12).

## R10. A finding in feature 002, fixed there

`SubmitReport` compared the version before `report.submit` checked the author (BR-6), so Henry
submitting Mark's report from a stale version got `409` instead of `403`. 002 R4 orders
permission before version. Fixed in feature 002 (`fix(reporting): check the author before the
version on submit`): `SubmitReport` now calls `report.assertAuthor` before comparing versions,
covered by a unit test and an API test. This feature does not change `SubmitReport`.
`ApproveReport` follows R1.
