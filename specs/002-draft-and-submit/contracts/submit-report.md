# Contract: `POST /reports/:reportId/submit`

The author submits a `DRAFT` or `REJECTED` report for review (spec US2, US3; UC-2; FR-010 to
FR-019, FR-021 to FR-029).

## Request

| Part | Value |
| --- | --- |
| Path | `reportId`: UUID |
| Query | none; any parameter is refused |
| Headers | `X-Actor-Id`, `X-Actor-Role`. `Idempotency-Key`: required ([idempotency.md](./idempotency.md)) |
| Body | `{ "version": 2 }`: integer ≥ 1, required (BR-15). Unknown fields are refused |

## `200 OK`

The report ([report-view.md](./report-view.md)) with `status` `SUBMITTED`, `version` increased,
items unchanged, and one more transition at the end of `transitions`: `fromStatus` `DRAFT` or
`REJECTED`, `toStatus` `SUBMITTED`, `actorId` the caller, `occurredAt` the time of submission,
`reason` `null` (BR-11).

No task's `approvedProgress` changes (FR-016).

## Errors

In the order they are checked (research R4).

| Status | Code | When | `details` |
| --- | --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Identity | none |
| `400` | `VALIDATION_FAILED` | `Idempotency-Key` missing or malformed | `issues`, path `headers.idempotency-key` |
| `409` | `IDEMPOTENCY_KEY_IN_PROGRESS` | Same key, same request, still running | none |
| `422` | `IDEMPOTENCY_KEY_REUSED` | Same key, different request | none |
| `400` | `VALIDATION_FAILED` | `reportId` not a UUID; `version` missing or not an integer ≥ 1; any other field | `issues` |
| `403` | `ROLE_CANNOT_AUTHOR_REPORTS` | Caller is a Site Supervisor | `role` |
| `404` | `REPORT_NOT_FOUND` | No such report | `reportId` |
| `403` | `NOT_REPORT_AUTHOR` | Caller is a Foreman but not the author (BR-6) | `reportId` |
| `409` | `REPORT_VERSION_CONFLICT` | `version` is not the current one (BR-15) | `expectedVersion`, `currentVersion` |
| `409` | `INVALID_STATUS_TRANSITION` | Report is `SUBMITTED` or `APPROVED` | `from`, `to` |
| `422` | `WORKSITE_CLOSED` | Worksite is `CLOSED` (BR-3) | `worksiteId` |
| `422` | `REPORT_HAS_NO_ITEMS` | No items (BR-7) | none |
| `422` | `TASK_NOT_ASSIGNED_TO_AUTHOR` | A task has been reassigned since the save (BR-4) | `taskId`, `taskName` |
| `422` | `PROGRESS_BELOW_APPROVED` | Reported progress below the task's current approved progress (BR-5) | `taskId`, `taskName`, `reportedProgress`, `approvedProgress` |

Messages:

- `INVALID_STATUS_TRANSITION`: `A SUBMITTED report cannot be submitted. Only a DRAFT or REJECTED report can be.`
- `REPORT_HAS_NO_ITEMS`: `A report needs at least one item to be submitted.`
- `PROGRESS_BELOW_APPROVED`: `The reported progress for "Build ground-floor walls" is 30%, below its approved progress of 40%.`

`TASK_LISTED_TWICE` and `TASK_NOT_IN_WORKSITE` are checked again too (BR-4), but a saved report
cannot break them: a task cannot leave its worksite, and the database holds one item per task.

Nothing is written when any error is returned, and the request key is released.
