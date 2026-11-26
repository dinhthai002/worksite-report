# Contract: `GET /reports/:reportId`

View one Daily Report with its items and history (spec US4; FR-030 to FR-033).

## Request

| Part | Value |
| --- | --- |
| Path | `reportId`: UUID |
| Query | none; any parameter is refused |
| Headers | `X-Actor-Id`, `X-Actor-Role` |
| Body | none; an absent or empty body is accepted |

No `Idempotency-Key`: the request writes nothing (API-02 applies to `POST` and `PUT`).

## `200 OK`

The report ([report-view.md](./report-view.md)).

**Who may view** (FR-030, Clarifications):

| Caller | `DRAFT` | `SUBMITTED`, `REJECTED`, `APPROVED` |
| --- | --- | --- |
| The author | `200` | `200` |
| The worksite's Site Supervisor | `403` | `200` |
| Any other Foreman or Site Supervisor | `403` | `403` |

## Errors

| Status | Code | When | `details` |
| --- | --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Identity | none |
| `400` | `VALIDATION_FAILED` | `reportId` not a UUID; a query parameter; a non-empty body | `issues` |
| `404` | `REPORT_NOT_FOUND` | No such report | `reportId` |
| `403` | `REPORT_VIEW_FORBIDDEN` | The table above | `reportId` |

`404` is checked before `403`, so a refused viewer learns that the report exists, but nothing of
its content (spec, Assumptions).

`REPORT_VIEW_FORBIDDEN` message: `You may not view this report. Only its author, and the worksite's site supervisor once it is submitted, may view it.`
