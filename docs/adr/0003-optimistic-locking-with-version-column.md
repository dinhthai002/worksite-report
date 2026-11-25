# ADR 0003: Optimistic locking with a version column

- Status: Accepted
- Date: 2026-11-25

## Context

BR-15 requires that a write based on a stale copy of a report is rejected, never silently applied. Conflicts are possible but rare: a foreman saves a draft from two devices, or a site supervisor approves while the foreman is still editing a rejected report. Users work over mobile networks and HTTP requests, so the time between reading a report and writing it can be minutes.

## Decision

Each `daily_reports` row has an integer `version`, starting at 1.

- Every response that returns a report includes its current `version` (API-04).
- Every edit and status transition sends the `version` the client last read.
- The repository writes with a conditional update: `WHERE id = $1 AND version = $expected`, incrementing `version` in the same statement (DB-03).
- Zero rows updated means the copy is stale. The repository raises a `ConflictError` (`REPORT_VERSION_CONFLICT`), returned as `409` with the current version in `details`.

## Consequences

- No database lock is held while a user is thinking, so a slow client never blocks others.
- Of two concurrent decisions, exactly one wins. Integration tests start both with `Promise.allSettled` and assert on the pair of outcomes.
- Clients must handle `409` by reloading. That is the intended behavior: the user sees what changed before deciding again.
- The check is only as good as its coverage, so every write path to a report must go through the conditional update. This is a review rule (DB-03) and is covered by integration tests.

Alternatives rejected:

- **Pessimistic locking (`SELECT … FOR UPDATE`).** It serializes writes inside one transaction, but cannot span the minutes between a user's read and their write over HTTP.
- **Comparing `updated_at` timestamps.** Two writes in the same millisecond, or clock differences, can pass the check. An integer that only the database increments has no such gap.
- **Last write wins.** Simple, but it is exactly the silent overwrite that BR-15 forbids.
