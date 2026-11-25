# ADR 0004: One transaction across two aggregates on approval

- Status: Accepted
- Date: 2026-11-25

## Context

Approving a daily report changes two aggregates: the `DailyReport` (status becomes `APPROVED`, a transition is recorded) and the `Worksite`, whose tasks get a new `approvedProgress`. BR-9 requires that all task updates succeed together or nothing changes, and BR-5 must be checked again at approval time, because another report may have been approved in the meantime.

The usual DDD guideline is one aggregate per transaction, with other aggregates updated eventually. Here that guideline conflicts with a business rule.

## Decision

Approval writes both aggregates in one database transaction, owned by the reporting repository.

- `PrismaDailyReportRepository` opens `$transaction`, updates the report conditionally on `version` and `status = SUBMITTED`, then updates each task with `WHERE approved_progress <= reported_progress`, and records the transition.
- Any failed condition throws, and the whole transaction rolls back. The report stays `SUBMITTED` and no task changes.
- The `ApproveReport` use case still checks permissions (BR-12) and the state machine (BR-10) in the domain before calling the repository. The conditional task update is the concurrency guard for BR-5, not a second copy of the rule's logic.

This is the only place where `reporting` infrastructure writes a table owned by `worksite`.

## Consequences

- BR-9 holds even under concurrent approvals. This is proven by integration tests that force a failure partway through.
- The `reporting` module knows the shape of the `tasks` table. A change to that table must be checked against the approval code.
- Revisit this decision when a second use case needs to write across aggregates. At that point a shared transaction port may pay for itself.

Alternatives rejected:

- **A UnitOfWork or transaction port in `shared/domain`,** with both repositories joining one transaction. It is cleaner in DDD terms, but every repository would need a transaction-aware variant, all for a single use case.
- **Domain events or an outbox,** with tasks updated after the report. Between the two writes the report is `APPROVED` while tasks show old progress, and a failure leaves them inconsistent. That breaks BR-9.
- **Merging worksite and report into one aggregate.** Every report save would load and lock the whole worksite, so foremen would conflict with each other on unrelated tasks.
- **A saga with compensating updates.** It adds the failure modes of distributed systems to what is a single database.
