# Contract: `PUT /worksites/:worksiteId/reports/:workDate`

Save the caller's Daily Report for a worksite and work date: create it, return the existing one, or
replace its content (spec US1, US3; UC-1; FR-001 to FR-009, FR-021 to FR-029).

## Request

| Part | Value |
| --- | --- |
| Path | `worksiteId`: UUID. `workDate`: `YYYY-MM-DD`, a date that exists |
| Query | none; any parameter is refused |
| Headers | `X-Actor-Id`, `X-Actor-Role` (feature 001). `Idempotency-Key`: required, see [idempotency.md](./idempotency.md) |
| Body | JSON, below. Unknown fields are refused |

```json
{
  "version": 2,
  "note": "Rain stopped work at 15:00.",
  "items": [
    { "taskId": "00000000-0000-4000-8000-000000000202", "reportedProgress": 55, "note": null }
  ]
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `version` | integer ≥ 1 | no | Omit on a first save. Send the version last read to change an existing report (BR-15) |
| `note` | string (≤ 2,000) \| `null` | no | Absent means `null` |
| `items` | array | yes | The complete list; it replaces the report's items (FR-002). May be empty |
| `items[].taskId` | UUID | yes | |
| `items[].reportedProgress` | integer | yes | The range 0 to 100 is a business rule: `422`, not `400` (research R5) |
| `items[].note` | string (≤ 2,000) \| `null` | no | A longer note is a `400` whose message names the task (R15) |

## Responses

| Case (research R8) | Status | Body |
| --- | --- | --- |
| No `version`; the caller had no report for this worksite and date | `201 Created` | The new report, `DRAFT`, `version` 1 ([report-view.md](./report-view.md)) |
| No `version`; the caller already has one (BR-1) | `200 OK` | The existing report, unchanged; the request's content is not applied |
| `version` matches; the report is `DRAFT` or `REJECTED` | `200 OK` | The report as saved, `version` increased, status unchanged |

A client that sent no `version` and receives `200` should reload and save again with the returned
`version`.

## Errors

Shape `{ "error": { "code", "message", "details"? } }` (API-03). Listed in the order they are
checked (research R4).

| Status | Code | When | `details` |
| --- | --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Identity (feature 001) | none |
| `400` | `VALIDATION_FAILED` | `Idempotency-Key` missing or malformed | `issues`, path `headers.idempotency-key` |
| `409` | `IDEMPOTENCY_KEY_IN_PROGRESS` | Same key, same request, still running | none |
| `422` | `IDEMPOTENCY_KEY_REUSED` | Same key, different request | none |
| `400` | `VALIDATION_FAILED` | Path, query or body malformed; progress not an integer; note too long | `issues` |
| `403` | `ROLE_CANNOT_AUTHOR_REPORTS` | Caller is a Site Supervisor | `role` |
| `404` | `WORKSITE_NOT_FOUND` | No such worksite | `worksiteId` |
| `409` | `REPORT_VERSION_CONFLICT` | `version` sent and the report has changed since, or the caller has no report here | `expectedVersion`, `currentVersion` (`null` when there is no report) |
| `409` | `REPORT_NOT_EDITABLE` | Report is `SUBMITTED` or `APPROVED` (BR-6) | `status` |
| `422` | `WORK_DATE_OUT_OF_RANGE` | First save outside today − limit … today (BR-2) | `workDate`, `earliest`, `latest` |
| `422` | `WORKSITE_CLOSED` | Worksite is `CLOSED` (BR-3) | `worksiteId` |
| `422` | `TASK_LISTED_TWICE` | A task appears twice (BR-4) | `taskId` |
| `422` | `TASK_NOT_IN_WORKSITE` | A task is not in this worksite (BR-4) | `taskId`, `worksiteId` |
| `422` | `TASK_NOT_ASSIGNED_TO_AUTHOR` | A task is assigned to someone else (BR-4) | `taskId`, `taskName` |
| `422` | `PROGRESS_OUT_OF_RANGE` | Progress below 0 or above 100 (BR-5) | `taskId`, `reportedProgress`, `min`, `max` |

Messages (each says what to fix):

- `WORK_DATE_OUT_OF_RANGE`: `The work date 2026-11-22 is outside the allowed range 2025-11-21 to 2026-11-21.`
- `WORKSITE_CLOSED`: `The worksite <worksiteId> is closed. Reports can be created and submitted only for an active worksite.`
- `TASK_NOT_ASSIGNED_TO_AUTHOR`: `The task "Install electrical" (<taskId>) is not assigned to you.`
- `PROGRESS_OUT_OF_RANGE`: `The reported progress for task <taskId> must be a whole number from 0 to 100.`
- `REPORT_NOT_EDITABLE`: `The report is SUBMITTED. Only a DRAFT or REJECTED report can be changed.`
- `REPORT_VERSION_CONFLICT`: `The report has changed since you read it (your version 2, current version 3). Reload it and try again.`

Nothing is written when any error is returned (FR-009), and the request key is released (FR-026).
