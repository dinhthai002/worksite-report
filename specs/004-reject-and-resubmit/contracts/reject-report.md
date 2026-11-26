# Contract: `POST /reports/:reportId/reject`

The worksite's Site Supervisor rejects a `SUBMITTED` report with a reason. The report becomes
`REJECTED`; no task changes. Its author can then edit and resubmit it with feature 002's endpoints,
unchanged (spec US1 to US4; UC-4; FR-001 to FR-021).

## Request

| Part | Value |
| --- | --- |
| Path | `reportId`: UUID |
| Query | none; any parameter is refused |
| Headers | `X-Actor-Id`, `X-Actor-Role`. `Idempotency-Key`: required ([002 idempotency.md](../../002-draft-and-submit/contracts/idempotency.md)) |
| Body | `{ "version": 3, "reason": "conduit laid, no wiring pulled yet" }` |

| Field | Type | Rule |
| --- | --- | --- |
| `version` | integer ≥ 1, required | The version last read (BR-15) |
| `reason` | string or `null`, optional in the schema | At most 2,000 characters, else `400` (FR-003). Missing, `null`, empty or only whitespace: `422 REJECTION_REASON_REQUIRED`, checked last (BR-8; Clarifications Q2). Stored exactly as sent, not trimmed (Clarifications Q4) |
| any other field | | Refused: `400` (FR-016) |

## `200 OK`

The report ([002 report-view.md](../../002-draft-and-submit/contracts/report-view.md)) with
`status` `REJECTED`, `version` increased by 1, items and note unchanged, and one more transition at
the end of `transitions`:

```json
{
  "fromStatus": "SUBMITTED",
  "toStatus": "REJECTED",
  "actorId": "00000000-0000-4000-8000-000000000001",
  "occurredAt": "2026-11-21T03:00:00.000Z",
  "reason": "conduit laid, no wiring pulled yet"
}
```

No task changes (FR-006). The same transition, with its reason, appears in every later response
that returns this report: `GET /reports/:reportId`, and the author's save and submit (FR-011).

## Errors

In the order they are checked ([research.md](../research.md) R1). Nothing is written when any error
is returned, and the request key is released.

| Status | Code | When | `details` |
| --- | --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Identity | none |
| `400` | `VALIDATION_FAILED` | `Idempotency-Key` missing or malformed | `issues`, path `headers.idempotency-key` |
| `409` | `IDEMPOTENCY_KEY_IN_PROGRESS` | Same key, same request, still running | none |
| `422` | `IDEMPOTENCY_KEY_REUSED` | Same key, different request (another report, version or reason) | none |
| `400` | `VALIDATION_FAILED` | `reportId` not a UUID; `version` missing or not an integer ≥ 1; `reason` not a string or `null`, or longer than 2,000 characters; any other field; a query parameter | `issues` |
| `404` | `REPORT_NOT_FOUND` | No such report | `reportId` |
| `403` | `REPORT_REJECTION_FORBIDDEN` | Caller is a Foreman, or a Site Supervisor of another worksite (BR-12), or the report is `DRAFT` (FR-008). One answer for all three (R2) | `reportId` |
| `409` | `REPORT_VERSION_CONFLICT` | `version` is not the current one (BR-15). Always the answer to the loser of two simultaneous decisions, approve or reject (FR-019) | `expectedVersion`, `currentVersion` |
| `409` | `INVALID_STATUS_TRANSITION` | Report is `APPROVED` (BR-10) or `REJECTED`, sent with its current version | `from`, `to` |
| `422` | `REJECTION_REASON_REQUIRED` | `reason` missing, `null`, empty or only whitespace (BR-8) | none |

Messages:

- `REPORT_REJECTION_FORBIDDEN`: `You may not reject this report. Only the site supervisor of its worksite may reject it, once it is submitted.`
- `INVALID_STATUS_TRANSITION`: `A APPROVED report cannot be rejected. Only a SUBMITTED report can be.` (002's message format)
- `REJECTION_REASON_REQUIRED`: `A reason is required to reject a report. Say what its author needs to change.`
- `VALIDATION_FAILED` for length: `The reason must be at most 2000 characters.`

Not errors (FR-007): a worksite closed after submission (BR-3), a task reassigned after
submission (BR-4), and a task whose approved progress is already above the report's figure (BR-5).
All reject normally; rejecting is how a Site Supervisor answers a report that approval refuses with
`REPORT_PROGRESS_OUTDATED` (003).

## Retries

A repeat with the same `Idempotency-Key` and the same body returns the stored `200` response, with
the version and transitions as they were then. No second transition is recorded (FR-017). A refused
rejection releases its key, so a retry with the same key is processed afresh (002 FR-026).

## After a rejection

Feature 002's endpoints, unchanged:

| Action | Endpoint | Result on a `REJECTED` report |
| --- | --- | --- |
| Author edits | `PUT /worksites/:worksiteId/reports/:workDate` ([save-draft.md](../../002-draft-and-submit/contracts/save-draft.md)) | `200`, status stays `REJECTED`, `version` + 1 |
| Author resubmits | `POST /reports/:reportId/submit` ([submit-report.md](../../002-draft-and-submit/contracts/submit-report.md)) | `200`, `SUBMITTED`, transition `REJECTED → SUBMITTED` |
| Anyone else edits or submits | same | `403` (`ROLE_CANNOT_AUTHOR_REPORTS` for a Site Supervisor, `NOT_REPORT_AUTHOR` for another Foreman) |
| Site Supervisor approves | `POST /reports/:reportId/approve` (003) | `409 INVALID_STATUS_TRANSITION`, `from` `REJECTED` |
