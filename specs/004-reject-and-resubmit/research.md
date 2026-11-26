# Research: Reject and resubmit a daily report

Phase 0 of [plan.md](./plan.md). The spec has no open questions (four were settled in
`/speckit-clarify`), the stack is fixed by the constitution, and features 002 and 003 already built
everything resubmission needs. Each entry below is a design decision. Format: decision, rationale,
alternatives. Feature 002's research is "002 R*n*", feature 003's is "003 R*n*".

## R1. Order of checks

**Decision.** `RejectReport` checks in the order of the spec's FR-021, which is 003 R1 with the
reason in place of progress:

| Step | Check | Where | Error |
| --- | --- | --- | --- |
| 1 | Identity | actor middleware (feature 001) | `401` |
| 2 | Request key present and well formed; claim | idempotency middleware (002 R9) | `400`, `409`, `422` |
| 3 | Path and body shape: `version` present; `reason`, if given, a string or `null` of at most 2,000 characters; no other field | `withValidInput`, `rejectReportBody` (R6) | `400` |
| 4 | Report exists | use case | `404 REPORT_NOT_FOUND` |
| 5 | Caller may reject this report: BR-12, and a `DRAFT` is answered the same way | `DailyReport.assertCanReject(actor, worksite)` (R2) | `403 REPORT_REJECTION_FORBIDDEN` |
| 6 | Stated version is current | use case, early; repository, conditional write (R4) | `409 REPORT_VERSION_CONFLICT` |
| 7 | Status is `SUBMITTED` (BR-10, Report lifecycle) | `assertTransition(status, REJECTED)` in `DailyReport.reject` | `409 INVALID_STATUS_TRANSITION` |
| 8 | Reason present and not blank (BR-8) | `DailyReport.reject` (R3) | `422 REJECTION_REASON_REQUIRED` |

The use case loads the worksite between steps 4 and 5, because BR-12 needs its Site Supervisor.

**Rationale.** The same reasons as 003 R1: permission before version, so a caller who may not
reject learns nothing about the report; version before status, so the loser of any race on a
report always gets `REPORT_VERSION_CONFLICT`. The reason comes last (spec, Clarifications Q2), so a
Foreman who sends no reason gets `403`, and the loser of a race gets `409` even if its reason was
blank.

**Alternatives.** A missing reason refused by the schema in step 3: refused in clarify (Q2). It
would also give a Foreman without a reason `400` instead of `403`.

## R2. BR-12 for rejection: its own code, the rule implemented once

**Decision.** `DailyReport` gets one private check, used by both decisions:

```ts
// BR-12: only the site supervisor of the report's worksite decides on it. A DRAFT gets the same answer (FR-009/FR-008).
private assertDecidableBy(actor: Actor, worksite: ReportWorksite, refusal: () => ForbiddenError): void
```

`assertCanApprove` (unchanged behavior, 003 R2) and a new public `assertCanReject` call it, each
with its own error:

```text
ForbiddenError("REPORT_REJECTION_FORBIDDEN",
  "You may not reject this report. Only the site supervisor of its worksite may reject it, once it is submitted.",
  { reportId })
```

**Rationale.** 003 R2 left the choice to this feature. A code of its own keeps feature 003's
contract unchanged (its API tests assert `REPORT_APPROVAL_FORBIDDEN`), and the message is true for
the action asked for. ARC-05 is kept: the rule (role, supervisor of this worksite, not a `DRAFT`)
is written once, in `assertDecidableBy`; only the wording differs.

**Alternatives.**

- Reuse `REPORT_APPROVAL_FORBIDDEN` for rejection: a message that says "approve" on a reject
  request.
- Rename both to `REPORT_DECISION_FORBIDDEN`: one code, but it changes a released contract and
  feature 003's tests, for no gain to a client, which already knows which action it sent.
- One public `assertCanDecide(actor, worksite, "approve" | "reject")`: works, but changes
  `ApproveReport` and every 003 unit test that calls `assertCanApprove`.

## R3. BR-8 in the domain

**Decision.** `DailyReport.reject(actor, worksite, reason: string | null, at: Date)`:

1. `assertCanReject(actor, worksite)` (BR-12).
2. `assertTransition(status, REJECTED)` (BR-10 for `APPROVED`, the lifecycle for `REJECTED`):
   `INVALID_STATUS_TRANSITION` with the existing message, `A APPROVED report cannot be rejected.
   Only a SUBMITTED report can be.`
3. BR-8: `reason === null || reason.trim() === ""` throws
   `RuleViolationError("REJECTION_REASON_REQUIRED", "A reason is required to reject a report. Say what its author needs to change.")`.
4. Appends `ReportTransition(SUBMITTED, REJECTED, actor.id, at, reason)` (BR-11) with `reason`
   exactly as given, not trimmed (Clarifications Q4). Items, note, author, worksite and work date
   are unchanged (FR-006).

Not checked: the worksite's status (BR-3), each task's assignee (BR-4), approved progress (BR-5)
(FR-007). `reject` does not read `worksite.tasks` at all.

**Rationale.** BR-8 is a business rule, so it lives in the domain and is tested there (ARC-05,
TST-01). `trim()` removes every character the database guard (R5) counts as space, and more
(for example a no-break space), so the domain is at least as strict as the database and a
rejection the domain accepts is never refused by the guard. `422` is the constitution's status for
a broken business rule.

**Alternatives.** `INVALID_STATUS_TRANSITION`-style `409` for a missing reason: the report's state
does not forbid the action; the request is incomplete. `400` from the schema: refused in clarify.

## R4. The rejection write: the existing `save`

**Decision.** `RejectReport` stores the rejected report with the existing
`DailyReportRepository.save(report, expectedVersion)`. No new port method.

**Rationale.** `save` already does exactly what a rejection needs, in one `$transaction` (DB-04):
`UPDATE daily_reports SET note, status, version = version + 1 WHERE id AND version = expected`
(BR-15, DB-03), `writeItems`, which writes only items that changed (none here, so items keep their
`updated_at` and order), and `appendTransitions`, which inserts the new transition with its
reason. Feature 002's `SubmitReport` uses the same path for `DRAFT → SUBMITTED`.

**Approval against rejection (FR-019).** Both writes are conditional on the same `version` and
increment it: `save` on `version`, `saveApproval` on `version` and `status = SUBMITTED` (003 R4).
At `READ COMMITTED`, the second `UPDATE` of the report row waits for the first transaction, then
re-evaluates its `WHERE` against the committed row, finds the version changed, matches zero rows
and throws `REPORT_VERSION_CONFLICT`. Its transaction rolls back, so if the loser was the approval,
no task was raised. The report row is the first row both transactions lock, so they cannot
deadlock. Two rejections race the same way.

**Alternatives.** A `saveRejection` conditional on `status = SUBMITTED` too, as `saveApproval` is:
the version condition already excludes every concurrent change of status, because every status
change increments the version. ADR 0004 needs the status condition for approval because approval
writes another aggregate; rejection writes only the report. One more port method, fake method and
integration test set for no extra guarantee (constitution X).

## R5. The database guards the reason

**Decision.** One new migration, `add_transition_reason_checks`, created with
`npx prisma migrate dev --create-only` (`schema.prisma` does not change, so Prisma generates an
empty file) and filled by hand (constitution VI):

```sql
ALTER TABLE "report_transitions" ADD CONSTRAINT "report_transitions_reason_length"
  CHECK (char_length("reason") <= 2000);
-- BR-8: a rejection has a reason with at least one non-space character.
ALTER TABLE "report_transitions" ADD CONSTRAINT "report_transitions_rejection_reason"
  CHECK ("to_status" <> 'REJECTED' OR ("reason" IS NOT NULL AND "reason" ~ '\S'));
```

**Rationale.** DB-02: value ranges are enforced by the database, as the 2,000-character limit on
notes is (002 migration `daily_reports_note_length`, `report_items_note_length`). The BR-8 guard
makes "0 rejection transitions without a reason" (SC-005) hold for any writer, not only the API.
Adding a `CHECK` validates existing rows but does not update them, so the append-only trigger on
`report_transitions` (002) is not fired. No released environment holds a `REJECTED` transition:
rejection has no endpoint before this feature, and the seed creates no reports.

**Length units.** Zod's `max(2000)` counts UTF-16 code units; `char_length` counts code points. A
string within Zod's limit is always within the database's, so the guard never turns a valid
request into a `500`. The same holds for notes (002).

**Alternatives.** No migration, the limit in the schema only: a writer other than the API could
store a 10,000-character or blank rejection reason, against DB-02.

## R6. Request body

**Decision.** `report.schemas.ts` adds:

```ts
/** The longest rejection reason: the note limit, by the spec's Clarifications Q1. The database guards it too. */
const REASON_MAX_LENGTH = 2000;

export const rejectReportBody = z.strictObject({
  version: z.number().int().min(1),
  // Missing or null is BR-8, decided in the domain (Clarifications Q2); only the type and length are checked here.
  reason: z.string().max(REASON_MAX_LENGTH, `The reason must be at most ${REASON_MAX_LENGTH} characters.`).nullable().optional(),
});
```

The route passes `body.reason ?? null`. The path reuses `reportParams`.

**Rationale.** Strict objects are the project's default; any other field is a `400` (FR-016). The
length is a format limit like the note's (FR-003: "refused as an invalid request"), so it is
checked by the schema, early. Missing and `null` reach the domain, which gives BR-8's refusal
(Clarifications Q2). A non-string reason, such as a number, is a malformed request: `400`.

**Alternatives.** `reason: z.string().min(1)`: refused in clarify, and it would treat `"   "`
differently from `""`. Sharing `NOTE_MAX_LENGTH`: the two limits are equal by decision, not by
definition; a named constant for each keeps them independently changeable.

## R7. Seeing the reason, editing and resubmitting: no code change

**Decision.** No change to `SaveDraft`, `SubmitReport`, `GetReport`, `toReportView` or their
contracts.

- `DailyReport.edit` already allows `REJECTED` (`isEditable`, BR-6) and leaves the status.
- `DailyReport.submit` already allows `REJECTED → SUBMITTED` through `ALLOWED_TRANSITIONS`, with
  every submission check (BR-3, BR-4, BR-5, BR-7).
- `toReportView` already returns every transition with its `reason`, and save, submit, approve,
  reject and view all return it (002 FR-031, FR-034). The Foreman sees the reason when viewing the
  report and in the response to the next save or submission (spec FR-011).
- `assertViewableBy` already lets the Site Supervisor view a `REJECTED` report (UC-5).

**Rationale.** Feature 002 built the full lifecycle; only the `SUBMITTED → REJECTED` step had no
action. This feature adds tests that reach `REJECTED` through the API instead of prepared data.

## R8. The walkthrough follows the PRD rows

**Decision.** `http/report-flow.http` is reordered to follow the PRD table, not the order the
features landed:

1. Feature 001 requests, unchanged.
2. Mark drafts, edits and submits (unchanged). **New:** Henry drafts Install electrical at 10% and
   submits. Linda views the townhouse: walls 40, electrical 0 (PRD row 1).
3. Linda approves Mark's report (unchanged); townhouse: 55, 0 (row 2).
4. **New:** Linda rejects Henry's report with "conduit laid, no wiring pulled yet"; townhouse 55,
   0 (row 3). Henry views his report and reads the reason. Henry saves electrical at 5%, then
   resubmits. Linda approves; townhouse 55, 5 (row 4). Linda views Henry's report: four
   transitions, the rejection with its reason.

Request keys are `walkthrough-004-*`. The header comment changes from "added here as each feature
lands" to "the whole PRD example". README "Run it" says the walkthrough creates Mark's and Henry's
reports for 20 November and runs the whole PRD example.

Henry's report versions: draft 1, submitted 2, rejected 3, edited 4, resubmitted 5, approved 6.

**Rationale.** Spec US6-1 asks that the progress the walkthrough shows matches every PRD row,
including "Both reports submitted, none approved", which needs Henry's submission before Linda's
first approval. FR-025: the README matches the file.

## R9. End-to-end and implementation-goal checks

**Decision.**

- `report-flow.api.test.ts` gets one test that runs the PRD example row by row with Mark, Henry
  and Linda, asserting both tasks' approved progress after each row (US5-1 to US5-4, FR-022,
  SC-001), and one that checks the 21 November refusals from the end state (US5-5). The two
  existing tests stay.
- The PRD's implementation goals (FR-023, SC-008) map to existing API tests, plus this feature's
  race:

| Goal | Test |
| --- | --- |
| 1. Safe retries (BR-14) | `idempotency.api.test.ts` (002): five identical saves, one report; this feature's repeated rejection (US4-6) |
| 2. No silent overwrites (BR-15) | `concurrency.api.test.ts`: two saves (002), two approvals (003), and **approve against reject** (new) |
| 3. Atomic approval (BR-9) | `approve-report.api.test.ts` (003) and `daily-report.repository.int.test.ts` `saveApproval` rollback (003) |

The plan lists them so `/speckit-analyze` and the reviewer can check the exit criterion without
searching.

## R10. Concurrency tests that cannot flake

**Decision.** `Promise.allSettled`, assertions on the set of outcomes (testing.md section 4; 003
R9).

- **Integration**, `daily-report.repository.int.test.ts`: `save` of a rejected copy and
  `saveApproval` of an approved copy, both from the same version, at once. Exactly one fulfils;
  the other rejects with `REPORT_VERSION_CONFLICT`. Exactly one new transition. If the approval
  won, the task has the reported progress; if the rejection won, no task changed.
- **API**, `concurrency.api.test.ts`: approve and reject of one report from one version: one `200`,
  one `409 REPORT_VERSION_CONFLICT`, never `INVALID_STATUS_TRANSITION`; Install electrical matches
  the winner. Two rejections: one `200`, one `409`.

## R11. Test data

**Decision.** As in 003 R8. Henry, the electrical task and Sam's worksite come from
`test/support/townhouse.ts` and `test/support/database.ts`. `Caller` in `townhouse.ts` gains
`reject(reportId, body, key)`, next to `approve`. A rejected report is now reached through the API
(Linda rejects); a closed worksite and a reassigned task are still prepared directly (002 R17).
`daily-report.builder.ts` already builds a `REJECTED` report for unit tests.

## R12. Starting point: features 002 and 003 committed

Features 002 and 003 are committed (`b73a92e` to `fdd369a`): `GetReport`, `ApproveReport`,
`assertCanApprove`, `saveApproval`, the walkthrough through Linda's approval, and open product
question P6. The working tree holds only this feature's spec directory, so this feature's commits
contain only its own change (GIT-01). The design above was checked against that commit.
