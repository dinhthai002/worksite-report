# Contract: `POST /reports/:reportId/approve`

The worksite's Site Supervisor approves a `SUBMITTED` report. The report becomes `APPROVED`, and
the approved progress of every task in it is set to its reported progress, together or not at all
(spec US1 to US4; UC-3; FR-001 to FR-020).

## Request

| Part | Value |
| --- | --- |
| Path | `reportId`: UUID |
| Query | none; any parameter is refused |
| Headers | `X-Actor-Id`, `X-Actor-Role`. `Idempotency-Key`: required ([002 idempotency.md](../../002-draft-and-submit/contracts/idempotency.md)) |
| Body | `{ "version": 3 }`: integer ≥ 1, required (BR-15). Any other field, including `reason` or `comment`, is refused (Clarifications Q4) |

## `200 OK`

The report ([002 report-view.md](../../002-draft-and-submit/contracts/report-view.md)) with
`status` `APPROVED`, `version` increased by 1, items and note unchanged, and one more transition at
the end of `transitions`:

```json
{
  "fromStatus": "SUBMITTED",
  "toStatus": "APPROVED",
  "actorId": "00000000-0000-4000-8000-000000000001",
  "occurredAt": "2026-11-21T03:00:00.000Z",
  "reason": null
}
```

Side effect: for every item, the task's `approvedProgress`, as `GET /worksites/:worksiteId` shows
it, equals the item's `reportedProgress` (BR-9). Only tasks whose approved progress goes up are
written; a task already at its reported value keeps its place in the worksite's task list. No
other task changes. The response does not include the tasks; read the worksite to see them.

## Errors

In the order they are checked (research R1). Nothing is written when any error is returned, and the
request key is released.

| Status | Code | When | `details` |
| --- | --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Identity | none |
| `400` | `VALIDATION_FAILED` | `Idempotency-Key` missing or malformed | `issues`, path `headers.idempotency-key` |
| `409` | `IDEMPOTENCY_KEY_IN_PROGRESS` | Same key, same request, still running | none |
| `422` | `IDEMPOTENCY_KEY_REUSED` | Same key, different request (another report, or another version) | none |
| `400` | `VALIDATION_FAILED` | `reportId` not a UUID; `version` missing or not an integer ≥ 1; any other field; a query parameter | `issues` |
| `404` | `REPORT_NOT_FOUND` | No such report | `reportId` |
| `403` | `REPORT_APPROVAL_FORBIDDEN` | Caller is a Foreman, or a Site Supervisor of another worksite (BR-12), or the report is `DRAFT` (FR-009). One answer for all three (research R2) | `reportId` |
| `409` | `REPORT_VERSION_CONFLICT` | `version` is not the current one (BR-15). Always the answer to the loser of two simultaneous approvals (Clarifications Q3) | `expectedVersion`, `currentVersion` |
| `409` | `INVALID_STATUS_TRANSITION` | Report is `APPROVED` or `REJECTED`, sent with its current version (BR-10) | `from`, `to` |
| `422` | `REPORT_PROGRESS_OUTDATED` | One or more tasks already have approved progress above the report's figure (BR-5) | `tasks`: every such task, see below |

Messages:

- `REPORT_APPROVAL_FORBIDDEN`: `You may not approve this report. Only the site supervisor of its worksite may approve it, once it is submitted.`
- `INVALID_STATUS_TRANSITION`: `A APPROVED report cannot be approved. Only a SUBMITTED report can be.` (002's message format)
- `REPORT_PROGRESS_OUTDATED`: `This report cannot be approved: approved progress is already above it for 1 task. "Build ground-floor walls": reported 40%, approved 60%. Reject the report so its author can update it.`

`REPORT_PROGRESS_OUTDATED` details, in the order of the report's items:

```json
{
  "tasks": [
    {
      "taskId": "00000000-0000-4000-8000-000000000202",
      "taskName": "Build ground-floor walls",
      "reportedProgress": 40,
      "approvedProgress": 60
    }
  ]
}
```

Not errors (FR-008): a worksite closed after submission (BR-3), and a task reassigned after
submission (BR-4). Both approve normally.

## Retries

A repeat with the same `Idempotency-Key` and the same body returns the stored `200` response, with
the version and transitions as they were then. No second transition is recorded and no task is
written again (FR-016). A refused approval releases its key, so a retry with the same key is
processed afresh (002 FR-026).
