# Research: Draft and submit a daily report

Phase 0 of [plan.md](./plan.md). The spec has no open questions (five were settled in
`/speckit-clarify`), and the stack is fixed by the constitution, so each entry below is a design
decision, not a technology choice. Format: decision, rationale, alternatives considered.

## R1. Branded IDs that both modules use

**Decision.** Move `WorksiteId`, `TaskId`, `toWorksiteId` and `toTaskId` from `worksite/domain`
to a new `src/shared/domain/ids.ts`, next to `UserId` in `actor.ts`. `worksite/domain` imports them
from there, and `worksite/index.ts` keeps exporting them under the same names. `ReportId` lives in
`reporting/domain/daily-report.ts`, because only `reporting` uses it.

**Rationale.** `reporting/domain` must refer to worksites and tasks (a report belongs to a worksite;
an item names a task), but ARC-01 allows it to import only `reporting/domain` and `shared/domain`.
`UserId` is already shared for the same reason. TS-08 asks for branded IDs in `domain`, so falling
back to `string` would lose the check that a `TaskId` is never passed where a `WorksiteId` is
expected.

**Alternatives.** Plain `string` IDs in `reporting/domain`: works, but drops TS-08 for the module
with the most IDs. A separate brand per module (`ReportedTaskId`): two types for one concept,
against NAM-03.

## R2. How the report sees its worksite

**Decision.** `reporting/domain/daily-report.ts` declares what a `DailyReport` needs to know
about its worksite:

```ts
export interface ReportTask {
  readonly id: TaskId;
  readonly name: string;
  readonly approvedProgress: Progress;
  isAssignedTo(userId: UserId): boolean;
}
export interface ReportWorksite {
  readonly id: WorksiteId;
  readonly status: "ACTIVE" | "CLOSED";
  readonly supervisorId: UserId;
  readonly tasks: readonly ReportTask[];
}
```

The use cases load the whole `Worksite` through `WorksiteRepository`, imported from
`worksite/index.ts` (implementation plan, section 3), and pass it to `DailyReport` methods. The
`Worksite` class satisfies `ReportWorksite` structurally, so no adapter is needed, and the compiler
checks the fit at every call site.

**Rationale.** It keeps both rules: `reporting/application` reads the whole aggregate through the
module's public API (ARC-03, plan section 3), and `reporting/domain` imports nothing from
`worksite` (ARC-01). If `WorksiteStatus` gains a value, `Worksite` stops fitting
`ReportWorksite` and the build fails where a decision is needed.

**Alternatives.** A mapping function in `application` from `Worksite` to a reporting-owned snapshot
class: more code for the same check. Moving `Worksite` to `shared/domain`: it is the `worksite`
module's aggregate, and `shared` holds only cross-cutting concepts.

## R3. `Progress` value object

**Decision.** `src/shared/domain/progress.ts` exports a branded `Progress` number, `isProgress(n)`
(an integer from 0 to 100) and `toProgress(n)`, which throws a plain `RangeError` when `n` is not
a progress. `Task.approvedProgress` becomes `Progress`, as `task.ts` already anticipates; the
worksite mapper converts with `toProgress`, trusting the database `CHECK`. `ReportItem` does not
call `toProgress`: it checks `isProgress` and throws the BR-5 `RuleViolationError` that names the
task (R6).

**Rationale.** The implementation plan puts `Progress` in `shared/domain` because both modules use
it. Keeping the rule's error in `ReportItem` lets the message name the task, which the value
object cannot know.

**Alternatives.** A `Progress` class: an object per number, with no benefit over a brand for a
single integer.

## R4. Where each rule is checked, and the order of checks

**Decision.** Every business rule is a method on `DailyReport`, `ReportItem`, `WorkDate` or
`ReportStatus` (ARC-05), cites its ID, and is checked in this order, so a request with several
faults gets the first one (spec, Edge Cases):

| Step | Check | Where | Error |
| --- | --- | --- | --- |
| 1 | Identity | actor middleware (feature 001) | `401` |
| 2 | Request key present and well formed; claim | idempotency middleware (R9) | `400`, `409`, `422` |
| 3 | Path, query and body shape | `withValidInput` and `report.schemas.ts` | `400` |
| 4 | Role may author reports (save, submit) | `DailyReport.assertCanAuthor(actor)` | `403` |
| 5 | Worksite or report exists | use case | `404` |
| 6 | Caller may act on this report (author; viewer) | `DailyReport` (BR-6, FR-030) | `403` |
| 7 | Stated version is current | use case, early; repository, conditional write | `409` |
| 8 | Status allows the action | `ReportStatus` transition table, `DailyReport.edit` (BR-6) | `409` |
| 9 | BR-2, BR-3, BR-7, BR-4, BR-5, in that order | `WorkDate`, `DailyReport`, `ReportItem` | `422` |

**Rationale.** It is the order the spec's Assumptions give: identity, format and key, role,
existence, report permission, rules. Checking the version before the status means a stale client
is told to reload, which also shows it the new status.

**Alternatives.** Collecting every violation into one response: the spec asks for at least the
first, and one error per response keeps the error shape (API-03) simple.

## R5. Progress range: `422` from the domain, not `400` from the schema

**Decision.** `report.schemas.ts` checks that `reportedProgress` is an integer and nothing more.
The range 0 to 100 is checked once, by `ReportItem` (BR-5), and refused with `422
PROGRESS_OUT_OF_RANGE`, naming the task. The database `CHECK` guards the same range as the last
line (DB-02).

**Rationale.** ARC-05: a rule is implemented once, in `domain`. The spec (US1-11, FR-007) requires
the refusal to name the task, which a schema issue path (`body.items.0.reportedProgress`) does not.
A value that is not an integer (55.5, `"55"`) is a malformed request, so it stays a `400`.

**Alternatives.** `z.number().int().min(0).max(100)`: a `400` that names an array index, and a
second copy of BR-5.

## R6. Error codes

**Decision.** Codes are stable (NAM-07). The kinds map to statuses in `error-handler.ts` only
(ERR-02); the error handler does not change.

| Code | Kind (status) | Rule | `details` |
| --- | --- | --- | --- |
| `WORKSITE_NOT_FOUND` | not found (`404`) | | `worksiteId` (feature 001) |
| `REPORT_NOT_FOUND` | not found (`404`) | | `reportId` |
| `ROLE_CANNOT_AUTHOR_REPORTS` | forbidden (`403`) | PRD Roles | `role` |
| `NOT_REPORT_AUTHOR` | forbidden (`403`) | BR-6 | `reportId` |
| `REPORT_VIEW_FORBIDDEN` | forbidden (`403`) | FR-030 | `reportId` |
| `REPORT_VERSION_CONFLICT` | conflict (`409`) | BR-15 | `expectedVersion`, `currentVersion` (`null` when the caller has no report) |
| `REPORT_NOT_EDITABLE` | conflict (`409`) | BR-6 | `status` |
| `INVALID_STATUS_TRANSITION` | conflict (`409`) | lifecycle | `from`, `to` |
| `WORK_DATE_OUT_OF_RANGE` | rule (`422`) | BR-2 | `workDate`, `earliest`, `latest` |
| `WORKSITE_CLOSED` | rule (`422`) | BR-3 | `worksiteId` |
| `TASK_LISTED_TWICE` | rule (`422`) | BR-4 | `taskId` |
| `TASK_NOT_IN_WORKSITE` | rule (`422`) | BR-4 | `taskId`, `worksiteId` |
| `TASK_NOT_ASSIGNED_TO_AUTHOR` | rule (`422`) | BR-4 | `taskId`, `taskName` |
| `PROGRESS_OUT_OF_RANGE` | rule (`422`) | BR-5 | `taskId`, `reportedProgress`, `min`, `max` |
| `PROGRESS_BELOW_APPROVED` | rule (`422`) | BR-5 | `taskId`, `taskName`, `reportedProgress`, `approvedProgress` |
| `REPORT_HAS_NO_ITEMS` | rule (`422`) | BR-7 | none |
| `IDEMPOTENCY_KEY_REUSED` | rule (`422`) | BR-14 | none |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | conflict (`409`) | BR-14 | none |

`TASK_NOT_IN_WORKSITE` cannot name the task: an ID from another worksite is not in the loaded
`Worksite`, so the message gives the ID. `TASK_NOT_ASSIGNED_TO_AUTHOR` gives the name as well.

A missing or malformed `Idempotency-Key` is a `400 VALIDATION_FAILED` with issue path
`headers.idempotency-key`, like every other malformed request (R9).

**Rationale.** One code per distinct reason a client handles differently. The statuses follow
architecture.md section 4.2: `403` permission, `409` stale version or a status that forbids the
action, `422` a broken rule or a reused key.

## R7. Work date and BR-2

**Decision.** In `reporting/domain/daily-report.ts`: a branded `WorkDate` string (`YYYY-MM-DD`) and
`assertCanCreateReportFor(workDate, today, limitDays)`, which computes
`earliest = today − limitDays` and `latest = today` with calendar arithmetic in UTC on the date
strings (no time of day, no time zone), and throws `WORK_DATE_OUT_OF_RANGE` with both dates when
`workDate` falls outside. Both bounds are inclusive. `today` comes from `Clock.today()`, which
already resolves `APP_TIME_ZONE` (feature 001), so the domain never sees a time zone.
`DailyReport.create` calls it. `edit` and `submit` do not (spec, Assumptions: the limit applies
when the report is created).

The path parameter is validated by `z.iso.date()`, which rejects `2026-02-30` and other dates that
do not exist, as a `400`.

**Rationale.** Calendar dates only (plan section 3). Doing the arithmetic on `YYYY-MM-DD` at UTC
midnight avoids daylight-saving shifts, which `Asia/Ho_Chi_Minh` does not have but another
configured zone might.

**Alternatives.** A date library: a new dependency (constitution X) for one subtraction.

## R8. Saving a draft: the three cases and BR-1

**Decision.** `PUT /worksites/:worksiteId/reports/:workDate` with an optional `version` in the
body:

| Request | Caller has a report for this worksite and date | Result |
| --- | --- | --- |
| No `version` | No | Create: `DailyReport.create` checks BR-2 to BR-5; `201` |
| No `version` | Yes | BR-1: return the existing report unchanged; nothing is checked or applied; `200` |
| `version` | Yes | Edit: version check, then `report.edit` (BR-6, BR-3, BR-4, BR-5 range); `200` |
| `version` | No | `409 REPORT_VERSION_CONFLICT`, `currentVersion: null` (spec, Edge Cases) |

The use case looks the report up first so that BR-1 returns the existing report even when the new
content would break a rule, for example a work date now outside the limit (US1-3). The lookup is
not the guard: `UNIQUE (worksite_id, author_id, work_date)` is (DB-02). When two first saves race,
the loser's insert fails with `P2002`; the repository translates it (ERR-04) into
`{ created: false, report: <existing> }`, so the loser also gets BR-1's answer (US3-9).

**Rationale.** A client knows which case it is in from what it sent: without a version, `201`
means created and `200` means "this already existed; reload and save with its version". With a
version, `200` means saved.

**Alternatives.** Throwing a `ConflictError` on `P2002` and catching it in the use case: control
flow through exceptions for an expected outcome. Answering BR-1 with `409`: BR-1 says "Return the
existing report", which is a success.

## R9. Idempotency middleware (BR-14)

**Decision.** `src/shared/infrastructure/http/idempotency.middleware.ts`, mounted in `app.ts` right
after the actor middleware (architecture.md section 6, step 3). It acts on `POST` and `PUT` only.

1. Validate the `Idempotency-Key` header with Zod: required, 1 to 255 visible ASCII characters.
   Otherwise `400 VALIDATION_FAILED`, issue path `headers.idempotency-key`.
2. Hash the request: SHA-256 (`node:crypto`) of the method, `req.originalUrl`, and the body as
   canonical JSON (object keys sorted). The actor is not in the hash; it is part of the key.
3. Claim the key: `INSERT … ON CONFLICT (actor_id, key) DO NOTHING`.
   - Inserted: run the route.
   - Not inserted, same hash, completed: replay the stored status and body.
   - Not inserted, same hash, not completed: `409 IDEMPOTENCY_KEY_IN_PROGRESS`.
   - Not inserted, different hash: `422 IDEMPOTENCY_KEY_REUSED`.
4. Wrap `res.json` for the claimed request. For a status below 400, store the status and body, then
   send. For any other status, delete the claim (release the key), then send. The response leaves
   only after the store write, so a client that retries as soon as it gets an answer finds the key
   completed, never in progress.

The storage port `IdempotencyKeyRepository` (`claim`, `find`, `complete`, `release`) is declared in
`idempotency.middleware.ts`, its only user, because idempotency is an HTTP concern, not a domain
one. It is
implemented by `src/shared/infrastructure/prisma-idempotency-key.repository.ts` and faked by
`test/fakes/in-memory-idempotency-key.repository.ts` (TST-06).

**Rationale.** Claim first, then a duplicate in flight is told so instead of running twice
(implementation plan, section 3). Releasing on failure is the plan's decision, and the spec's
FR-026. Storing before sending removes a race that would make the five-requests test flaky
(TST-12).

**Known limit.** The claim and the use case's transaction are separate. If the process dies after
the use case commits and before the response is stored, the key stays "in progress" and a retry
gets `409` until someone deletes the row. The report itself is still written once. The PRD does not
ask for recovery; a later feature can expire stale claims. Keys do not otherwise expire (spec,
Assumptions).

**Alternatives.** Storing the response in the use case's transaction: makes every use case aware of
HTTP replay. Checking for an existing key before inserting: a check-then-insert race (DB-02).

## R10. Optimistic locking (BR-15)

**Decision.** As ADR 0003: `daily_reports.version` starts at 1. Every write by the repository is
`UPDATE daily_reports SET …, version = version + 1 WHERE id = $id AND version = $expected`
(through Prisma `updateMany`, whose `count` is checked). Zero rows: throw
`ConflictError("REPORT_VERSION_CONFLICT")` with the current version, read in the same transaction,
which rolls back. The use case also compares the loaded version with the stated one before running
any rule, so a stale client is answered without doing work (R4, step 7). The repository returns the
report reloaded after the write, so the response carries the new version and the stored item order.

**Rationale.** ADR 0003, DB-03. The early check is an optimization; the conditional write is the
guard.

## R11. Writing a save: items by difference, in one transaction

**Decision.** `DailyReportRepository.save(report, expectedVersion)` runs one `$transaction`
(DB-04):

1. The conditional `UPDATE` of `daily_reports` (R10): note, status, version.
2. Load the stored items of the report, then: delete the items whose task is no longer in the
   report; insert new ones; update only the items whose progress or note changed.
3. For `submit`: insert the new transition.

**Rationale.** FR-002 replaces the whole list, and FR-032 lists items last changed first. Deleting
and re-inserting every item would give every item the same timestamps on every save, so "last
changed" would mean nothing. Updating only what changed keeps `updated_at` meaningful.

**Alternatives.** Delete all, insert all: simpler, but breaks FR-032's meaning.

## R12. Report items and transitions in the database

**Decision.**

- `report_items` has the composite primary key `(report_id, task_id)`, which is also BR-4's "at
  most once" constraint (DB-02). No surrogate ID: an item's identity is its task within its report.
- `report_transitions` has a `uuid` ID supplied by the repository, an `occurred_at` set from
  `Clock.now()` by the domain (ARC-10), and the usual `created_at` and `updated_at`
  (architecture.md section 5.5). A trigger `report_transitions_append_only` raises an exception on
  `UPDATE` and `DELETE` (BR-11, FR-020). `TRUNCATE` is not blocked, so test truncation (TST-08)
  still works.
- Transitions are ordered `occurred_at` ascending, then `id` (FR-032, the recorded exception).

**Rationale.** The database, not the code, makes transitions permanent, as FR-020 asks. The table
keeps both timestamp columns and the `set_updated_at` trigger so it follows section 5.5 like every
other table, even though the append-only trigger, which fires first, refuses every update.

## R13. Who may view a report (FR-030)

**Decision.** `DailyReport.assertViewableBy(actor, worksite)`: the author always; the worksite's
Site Supervisor unless the status is `DRAFT`; anyone else `403 REPORT_VIEW_FORBIDDEN`. `GetReport`
loads the report (`404` if missing), then its worksite, then asks the aggregate.

**Rationale.** The rule depends on the report's status and the worksite's supervisor, both
domain data, so it belongs in the aggregate (ARC-05), as `Worksite.tasksVisibleTo` does in feature
001.

## R14. Report timestamps in responses

**Decision.** `occurredAt` is rendered with `Date.prototype.toISOString()`: ISO 8601 in UTC, with
the offset `Z`.

**Rationale.** Architecture.md section 4.1 asks for ISO 8601 with an offset; `Z` is one, it is
what `JSON.stringify` gives a `Date`, and it is unambiguous. Converting to `APP_TIME_ZONE` is a
presentation choice for a client.

**Alternatives.** Rendering in `APP_TIME_ZONE` (`+07:00`): needs a formatting helper and makes the
response depend on configuration.

## R15. Notes

**Decision.** `note` on the report and on each item is optional: absent or `null` means no note.
`report.schemas.ts` limits it to 2,000 characters; for an item, a refinement on the item object
puts the task ID in the message: `The note for task <taskId> is longer than 2000 characters.`
The database adds `CHECK (char_length(note) <= 2000)` on both columns. An empty string is stored as
given.

**Rationale.** FR-002a: an invalid request (`400`), stating the limit and, for an item, naming the
task. The length limit is not a business rule, so it is checked at the boundary and guarded by the
database, not by the domain.

## R16. The default backdating limit is 365 days (FR-037a)

**Decision.** `src/config.ts` exports `DEFAULT_BACKDATE_LIMIT_DAYS = 365` and uses it as the Zod
default for `BACKDATE_LIMIT_DAYS` (was 5). `.env.example` and the
`docker-compose.yml` environment say `365`. architecture.md section 7 gives the new default.
`test/support/test-app.ts` passes `DEFAULT_BACKDATE_LIMIT_DAYS`, so the API tests check BR-2 at the
default without reading the environment.

**Rationale.** The decision after planning (spec, Clarifications) is one limit for every
environment. It also removes the walkthrough's special Compose setting: 20 November 2026 is inside
the default until 20 November 2027. Exporting the constant gives the default one source, which the
config schema and the test app both use.

**Alternatives.** A 3650-day limit for the walkthrough only, with the default at 5 (the first
answer in clarify): replaced by this decision. A literal `365` in the test app: two copies of the
default that could drift.

**Open.** BR-2 in `use-cases.md` still says 5 days. The product owner changes it in a separate,
approved edit (spec, Conflicts between documents).

## R17. Test data for states this feature cannot reach

**Decision.** `test/support/daily-report.builder.ts` (`aReport().rejected().build()`, TST-10)
builds aggregates for unit tests. For integration and API tests, `test/support/database.ts` gains
`insertReport(client, row)` and `insertReportItem(client, row)`, which write rows directly, so a
test can prepare a `REJECTED` or `APPROVED` report. A closed worksite and a reassigned task are
prepared with the existing `insertWorksite({ status: "CLOSED" })` and a direct task update.

**Rationale.** The spec's Scope boundaries: `REJECTED`, `APPROVED`, closing and reassigning appear
only as prepared test data until features 003 to 005 add the actions.

## R18. Concurrency tests that cannot flake

**Decision.**

- Two saves from the same version (`concurrency.api.test.ts`): always exactly one `200` and one
  `409`, whichever wins, because the conditional update serializes them.
- Ten concurrent first saves: exactly one report; one `201` and nine `200`, all with the same
  report ID.
- Two concurrent requests with the same key (`idempotency.api.test.ts`): the API test accepts
  either pair, one success and one `409 IDEMPOTENCY_KEY_IN_PROGRESS`, or two identical successes
  (the second arrived after the first was stored), and asserts that one report exists. The
  in-progress answer itself is proven deterministically by a unit test with the in-memory store and
  an integration test of the claim.

All use `Promise.allSettled` and assert on the set of outcomes (testing.md, section 4).

**Rationale.** The implementation plan's step 2 test "one succeeds, one returns `409`" for the same
key depends on timing. Asserting on the only outcome the code guarantees keeps TST-12.

## R19. File layout of the `reporting` module

**Decision.** `reporting` has the same shape as `worksite` (feature 001):

| `worksite` | `reporting` | Holds |
| --- | --- | --- |
| `domain/worksite.ts` | `domain/daily-report.ts` | The aggregate root, its ID, its status, and the small value types only it uses: `ReportStatus` with the transition table, `WorkDate` with BR-2, `ReportTransition`, `ReportWorksite` |
| `domain/task.ts` | `domain/report-item.ts` | The child entity |
| `domain/worksite.repository.ts` | `domain/daily-report.repository.ts` | The port (NAM-05) |
| `application/get-worksite.ts` | `application/get-report.ts` | The read use case and the view types the other use cases reuse |

The idempotency storage port is declared in `idempotency.middleware.ts`, its only user.

**Rationale.** No rule asks for one file per value object: ARC-06 limits `application` to one use
case per file, and NAM-05 asks for the port's `.repository.ts` file. A file per type would put
seven files in `reporting/domain` for one aggregate, and a reader would open five of them to follow
one `submit`. Unit tests mirror files (TST-13), so `daily-report.test.ts` holds the status table,
work date and aggregate tests in separate `describe` blocks.

**Alternatives.** One file per type (the first draft of this plan): easier to find a type by file
name, but more files than the module has concepts. `ReportItem` inside `daily-report.ts` too:
possible, but `worksite` keeps its child entity apart, and the two modules should read the same way.
