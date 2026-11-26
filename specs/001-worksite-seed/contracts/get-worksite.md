# Contract: `GET /worksites/:worksiteId`

View a worksite and the tasks the caller may see (spec US1; FR-007 to FR-012).

## Request

| Part | Value |
| --- | --- |
| Path | `worksiteId`: a UUID |
| Query | none; any parameter is refused |
| Headers | `X-Actor-Id`, `X-Actor-Role`: see [identity.md](./identity.md). `X-Request-Id`: optional |
| Body | none; an absent or empty body is accepted, anything else is refused |

No `Idempotency-Key`: the request writes nothing (API-02 applies to `POST` and `PUT`).

## `200 OK`

```json
{
  "id": "00000000-0000-4000-8000-000000000101",
  "name": "Three-storey townhouse",
  "status": "ACTIVE",
  "supervisorId": "00000000-0000-4000-8000-000000000001",
  "tasks": [
    {
      "id": "00000000-0000-4000-8000-000000000201",
      "name": "Pour foundation",
      "assigneeId": "00000000-0000-4000-8000-000000000002",
      "approvedProgress": 100
    },
    {
      "id": "00000000-0000-4000-8000-000000000202",
      "name": "Build ground-floor walls",
      "assigneeId": "00000000-0000-4000-8000-000000000002",
      "approvedProgress": 40
    },
    {
      "id": "00000000-0000-4000-8000-000000000203",
      "name": "Install electrical",
      "assigneeId": "00000000-0000-4000-8000-000000000003",
      "approvedProgress": 0
    }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | |
| `name` | string | |
| `status` | `"ACTIVE"` \| `"CLOSED"` | |
| `supervisorId` | UUID | User identifier only; no name or role (FR-008, FR-009) |
| `tasks` | array | Possibly empty |
| `tasks[].id` | UUID | |
| `tasks[].name` | string | |
| `tasks[].assigneeId` | UUID | User identifier only |
| `tasks[].approvedProgress` | integer 0 to 100 | |

**Which tasks** (FR-008a): a `SITE_SUPERVISOR` gets every task of the worksite. A `FOREMAN` gets
only the tasks whose `assigneeId` is their own ID, and `[]` when they have none there. For the
example worksite, Linda gets 3 tasks, Mark gets `201` and `202`, Henry gets `203`.

**Order** (FR-010): `updatedAt` descending, then `createdAt` ascending, then `id` ascending. The
example as loaded is listed `201`, `202`, `203`.

## Errors

Every error uses the shape `{ "error": { "code", "message", "details"? } }` (API-03).

| Status | Code | When | `details` |
| --- | --- | --- | --- |
| `400` | `VALIDATION_FAILED` | `worksiteId` is not a UUID; any query parameter is sent; a non-empty body is sent | `issues: [{ path, message }]`, `path` is `params.worksiteId`, `query` (the message names the unknown key) or `body` |
| `401` | `UNAUTHENTICATED` | Any identity failure; checked before the path is looked up | none ([identity.md](./identity.md)) |
| `404` | `WORKSITE_NOT_FOUND` | No worksite has this ID | `worksiteId` |

`404` message: `There is no worksite with ID <worksiteId>.`
