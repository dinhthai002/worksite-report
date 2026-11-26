# Quickstart: validate Draft and submit a daily report

Runnable checks that prove the feature works end to end. Endpoint details are in
[contracts/](./contracts/); the example IDs are in [data-model.md](./data-model.md), section 5.

## Prerequisites

- Docker, for Compose and for Testcontainers.
- Node.js 22 and `npm ci`.
- `curl` and `jq` for sections 3 to 6, or `http/report-flow.http` in an HTTP client instead.

## 1. Automated checks

```bash
npm run check        # typecheck, Biome, dependency-cruiser, unit tests
npm run test:all     # unit, integration, API
npm run test:cov     # domain and application at or above 90%
```

Expected: every command exits 0. `grep -rhoE "BR-(1|2|3|4|5|6|7|11|14|15)\b" test | sort -u` lists
all ten rules of this feature (TST-01).

## 2. Start the stack

The walkthrough reports on 20 November 2026, as the PRD example does. The default backdating limit
of 365 days accepts that date until 20 November 2027 (FR-037a). To repeat the walkthrough from
scratch, remove the data first: reports are not part of the seed.

```bash
docker compose down -v      # only to start over
docker compose up --build
```

Expected: `migrate` applies two migrations and exits 0; `api` is healthy.

```bash
B=http://localhost:3000
W=00000000-0000-4000-8000-000000000101
WALLS=00000000-0000-4000-8000-000000000202
ELEC=00000000-0000-4000-8000-000000000203
MARK=(-H 'X-Actor-Id: 00000000-0000-4000-8000-000000000002' -H 'X-Actor-Role: FOREMAN')
LINDA=(-H 'X-Actor-Id: 00000000-0000-4000-8000-000000000001' -H 'X-Actor-Role: SITE_SUPERVISOR')
JSON=(-H 'Content-Type: application/json')
```

## 3. Mark drafts, edits and submits (US1, US2; plan exit criterion)

```bash
# Draft: walls at 55%.
curl -s -X PUT $B/worksites/$W/reports/2026-11-20 "${MARK[@]}" "${JSON[@]}" -H 'Idempotency-Key: q-1' \
  -d "{\"items\":[{\"taskId\":\"$WALLS\",\"reportedProgress\":55}]}" | tee /tmp/r.json | jq '{status, version}'
R=$(jq -r .id /tmp/r.json)
```

Expected: `201`; `{"status":"DRAFT","version":1}`.

```bash
# Edit: add a note, from version 1.
curl -s -X PUT $B/worksites/$W/reports/2026-11-20 "${MARK[@]}" "${JSON[@]}" -H 'Idempotency-Key: q-2' \
  -d "{\"version\":1,\"note\":\"Rain from 15:00.\",\"items\":[{\"taskId\":\"$WALLS\",\"reportedProgress\":55}]}" \
  | jq '{status, version, note}'
```

Expected: `200`; `DRAFT`, version 2, the note.

```bash
# Submit from version 2.
curl -s -X POST $B/reports/$R/submit "${MARK[@]}" "${JSON[@]}" -H 'Idempotency-Key: q-3' -d '{"version":2}' \
  | jq '{status, version, transitions}'
```

Expected: `200`; `SUBMITTED`, version 3, one transition `DRAFT` → `SUBMITTED` by Mark.

```bash
# Approved progress is unchanged.
curl -s $B/worksites/$W "${LINDA[@]}" | jq '.tasks[] | {name, approvedProgress}'
```

Expected: Build ground-floor walls still at 40 (FR-016).

## 4. Retries and stale copies (US3)

```bash
# Repeat the submission with the same key: the same response, no second transition.
curl -s -X POST $B/reports/$R/submit "${MARK[@]}" "${JSON[@]}" -H 'Idempotency-Key: q-3' -d '{"version":2}' \
  | jq '{version, n: (.transitions | length)}'
# The same key with a different body.
curl -s -X POST $B/reports/$R/submit "${MARK[@]}" "${JSON[@]}" -H 'Idempotency-Key: q-3' -d '{"version":3}' | jq .error.code
# A stale version, with a new key.
curl -s -X PUT $B/worksites/$W/reports/2026-11-20 "${MARK[@]}" "${JSON[@]}" -H 'Idempotency-Key: q-4' \
  -d "{\"version\":1,\"items\":[]}" | jq .error
```

Expected: `{"version":3,"n":1}`; `"IDEMPOTENCY_KEY_REUSED"` (`422`); `REPORT_VERSION_CONFLICT`
(`409`) with `currentVersion` 3.

## 5. Rules (US1, US2)

```bash
# BR-4: Mark reports on Henry's task.
curl -s -X PUT $B/worksites/$W/reports/2026-11-21 "${MARK[@]}" "${JSON[@]}" -H 'Idempotency-Key: q-5' \
  -d "{\"items\":[{\"taskId\":\"$ELEC\",\"reportedProgress\":10}]}" | jq .error.code
# BR-2: a date in the future.
curl -s -X PUT $B/worksites/$W/reports/2099-01-01 "${MARK[@]}" "${JSON[@]}" -H 'Idempotency-Key: q-6' \
  -d '{"items":[]}' | jq .error
# Site Supervisor cannot save.
curl -s -X PUT $B/worksites/$W/reports/2026-11-21 "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: q-7' \
  -d '{"items":[]}' | jq .error.code
```

Expected: `TASK_NOT_ASSIGNED_TO_AUTHOR` (`422`); `WORK_DATE_OUT_OF_RANGE` (`422`) with
`earliest` and `latest`; `ROLE_CANNOT_AUTHOR_REPORTS` (`403`).

## 6. Viewing (US4)

```bash
curl -s $B/reports/$R "${LINDA[@]}" | jq '{status, version}'
curl -s -o /dev/null -w '%{http_code}\n' $B/reports/$R \
  -H 'X-Actor-Id: 00000000-0000-4000-8000-000000000003' -H 'X-Actor-Role: FOREMAN'
```

Expected: Linda, the townhouse's Site Supervisor, gets `200` for the submitted report; Henry gets
`403`.

## 7. Manual walkthrough

`http/report-flow.http` runs sections 3 and 6 as named requests (FR-037; SC-008).
