# Contract: request keys on `POST` and `PUT`

Applies to every `POST` and `PUT` of the application, from this feature on (BR-14, API-02; spec
US3; FR-021 to FR-026). Implemented once, in `idempotency.middleware.ts` (research R9).

## Header

`Idempotency-Key`: 1 to 255 visible ASCII characters (`!` to `~`). A UUID is a good choice. The
client creates a new key for each action it means to perform, and reuses the key only to retry
that same action.

## Behavior

A key belongs to the user who sent it (FR-025): Mark's `abc` and Henry's `abc` are unrelated.

"The same request" means the same method, the same path, and the same body (compared as JSON, so
the order of object keys does not matter).

| Situation | Response |
| --- | --- |
| Key missing or malformed | `400 VALIDATION_FAILED`, issue path `headers.idempotency-key`. Nothing is recorded |
| First use of the key | The request runs. A success (status below 400) is stored with the key; any other outcome releases the key (FR-026) |
| Key used before for the same request, completed | The stored status and body are returned again; the request does not run (FR-022) |
| Key used before for the same request, still running | `409 IDEMPOTENCY_KEY_IN_PROGRESS`: `The original request with this Idempotency-Key is still being processed. Retry it later.` (FR-024) |
| Key used before for a different request | `422 IDEMPOTENCY_KEY_REUSED`: `This Idempotency-Key was already used for a different request. Use a new key.` (FR-023) |
| Key whose earlier request failed or was refused | Treated as a first use: the request runs again |

A replayed response is identical to the original: same status, same body.

## Order in the request flow

After the identity check and before the route's input validation (architecture.md, section 6). So
an unauthenticated request never claims a key, and a request with an invalid body claims the key,
receives `400`, and releases it.

## Examples

```text
PUT /worksites/…0101/reports/2026-11-20   Idempotency-Key: k1   body A   → 201, report R, version 1
PUT /worksites/…0101/reports/2026-11-20   Idempotency-Key: k1   body A   → 201, same body (replayed)
PUT /worksites/…0101/reports/2026-11-20   Idempotency-Key: k1   body B   → 422 IDEMPOTENCY_KEY_REUSED
PUT /worksites/…0101/reports/2026-11-20   Idempotency-Key: k2   body B   → 200, version 1, BR-1: B is not applied
```
