# Contract: caller identity and request handling

Applies to every request (spec US2; FR-001 to FR-006, FR-020 to FR-023).

## Order of processing

1. Request log: assign the request ID (always, including for refused requests).
2. JSON body parsing: an unreadable body is refused here, before identity (FR-022).
3. `GET /health`: answered without identity.
4. Actor check (this contract).
5. Module routes, then `404 ROUTE_NOT_FOUND` for anything unmatched.

## Identity headers

| Header | Value |
| --- | --- |
| `X-Actor-Id` | UUID of a known user |
| `X-Actor-Role` | `FOREMAN` or `SITE_SUPERVISOR`, exact case, equal to the user's stored role |

The request passes only when both headers are present and well-formed, the ID belongs to a user,
and the role equals that user's stored role.

## `401 Unauthorized`

Every identity failure returns the same body:

```json
{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Send X-Actor-Id as the UUID of a known user and X-Actor-Role as that user's role: FOREMAN or SITE_SUPERVISOR."
  }
}
```

| Failure | Logged reason (`warn`, with `requestId`) |
| --- | --- |
| One or both headers absent | `HEADERS_MISSING` |
| ID not a UUID, or role not a glossary role (including wrong case) | `HEADERS_MALFORMED` |
| Well-formed ID that belongs to no user | `UNKNOWN_USER` |
| Known user, stated role differs from stored role | `ROLE_MISMATCH` |

The reason is never returned to the caller (FR-005a).

## Other request handling

| Case | Status | Code |
| --- | --- | --- |
| No route matches | `404` | `ROUTE_NOT_FOUND`; message `There is no route for <METHOD> <path>.` |
| JSON body cannot be parsed | `400` | `MALFORMED_JSON` |
| Any unexpected error | `500` | `INTERNAL_ERROR`; generic message, details in the log only |

## `X-Request-Id`

Every response carries `X-Request-Id`. A caller value matching `^[A-Za-z0-9-]{1,64}$` is echoed.
A missing or non-matching value is replaced by a new UUID (FR-023).
