# Quickstart: validate Worksite seed and identity check

Runnable checks that prove the feature works end to end. Endpoint details are in
[contracts/](./contracts/), and IDs in [data-model.md](./data-model.md), section 4.

## Prerequisites

- Docker, for Compose and for Testcontainers.
- Node.js 22 and `npm ci`, for the tests and `npx prisma db seed`.

## 1. Automated checks

```bash
npm run check        # typecheck, Biome, dependency-cruiser, unit tests
npm run test:int     # runs at least one test; --passWithNoTests is gone
npm run test:all     # unit, integration, API
npm run test:cov     # domain and application at or above 90%
```

Expected: every command exits 0.

## 2. Start the stack

```bash
docker compose up --build
```

Expected: `migrate` logs the migration and one seed line with mode `fill`, then exits 0. `api`
becomes healthy, and `curl -i http://localhost:3000/health` returns `200`.

## 3. View the worksite (US1)

```bash
W=00000000-0000-4000-8000-000000000101
curl -s localhost:3000/worksites/$W \
  -H 'X-Actor-Id: 00000000-0000-4000-8000-000000000001' -H 'X-Actor-Role: SITE_SUPERVISOR'
```

Expected: `200`, status `ACTIVE`, three tasks with `approvedProgress` 100, 40, 0, in that order.

| Caller | `X-Actor-Id` suffix | `X-Actor-Role` | Expected tasks |
| --- | --- | --- | --- |
| Linda | `…0001` | `SITE_SUPERVISOR` | `…0201`, `…0202`, `…0203` |
| Mark | `…0002` | `FOREMAN` | `…0201`, `…0202` |
| Henry | `…0003` | `FOREMAN` | `…0203` |

The same requests are in `http/report-flow.http`.

## 4. Refusals (US2)

| Request | Expected |
| --- | --- |
| No actor headers | `401 UNAUTHENTICATED` |
| `X-Actor-Id: 00000000-0000-4000-8000-000000000999`, `FOREMAN` | `401`, same body as above |
| Mark's ID with `SITE_SUPERVISOR` | `401`, same body as above |
| Linda, `GET /worksites/00000000-0000-4000-8000-000000000999` | `404 WORKSITE_NOT_FOUND` |
| Linda, `GET /worksites/not-a-uuid` | `400 VALIDATION_FAILED` |
| Linda, `GET /worksites/00000000-0000-4000-8000-000000000101?foo=1` | `400 VALIDATION_FAILED`, issue path `query`, message naming `foo` |
| Linda, `GET /nowhere` | `404 ROUTE_NOT_FOUND` |
| `GET /health` with no headers | `200` |

The `api` log shows a `warn` line with the reason (`HEADERS_MISSING`, `UNKNOWN_USER`,
`ROLE_MISMATCH`) for each `401`.

## 5. Restart keeps data, reset restores it (US3)

```bash
docker compose exec db psql -U postgres -d worksite_report \
  -c "UPDATE tasks SET approved_progress = 55 WHERE id = '00000000-0000-4000-8000-000000000202'"
docker compose down && docker compose up -d
```

Expected: view as Linda shows Build ground-floor walls at 55, listed first (most recently changed).

```bash
docker compose run --rm migrate node dist/prisma/seed.js --reset
```

Expected: view as Linda shows 100, 40, 0 again in PRD order, and the database still has exactly
3 users, 1 worksite and 3 tasks.
