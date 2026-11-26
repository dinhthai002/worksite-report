# Quickstart: validate Approve a daily report

Runnable checks that prove the feature works end to end. The endpoint is in
[contracts/approve-report.md](./contracts/approve-report.md); the example IDs are in
[002's data-model.md](../002-draft-and-submit/data-model.md), section 5.

## Prerequisites

- Everything in [002's quickstart](../002-draft-and-submit/quickstart.md), Prerequisites.
- Feature 002 complete, including `GET /reports/:reportId` and its walkthrough (002 tasks T045 to
  T055).

## 1. Automated checks

```bash
npm run check        # typecheck, Biome, dependency-cruiser, unit tests
npm run test:all     # unit, integration, API
npm run test:cov     # domain and application at or above 90%
```

Expected: every command exits 0.
`grep -rhoE "BR-(5|9|10|12|15)\b" test/unit/modules/reporting test/integration test/api | sort -u`
lists all five rules this feature implements (TST-01).

## 2. Start the stack and submit Mark's report

Run [002's quickstart](../002-draft-and-submit/quickstart.md) sections 2 and 3. They start the
stack from scratch, set `B`, `W`, `WALLS`, `MARK`, `LINDA`, `JSON`, and leave Mark's report for
20 November in `$R`, `SUBMITTED` at version 3, with Build ground-floor walls at 55%.

```bash
HENRY=(-H 'X-Actor-Id: 00000000-0000-4000-8000-000000000003' -H 'X-Actor-Role: FOREMAN')
```

## 3. Refusals before approval (US3)

```bash
# Mark, the author, tries to approve.
curl -s -X POST $B/reports/$R/approve "${MARK[@]}" "${JSON[@]}" -H 'Idempotency-Key: a-1' \
  -d '{"version":3}' | jq .error.code
# Linda sends a stale version.
curl -s -X POST $B/reports/$R/approve "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: a-2' \
  -d '{"version":2}' | jq '.error | {code, details}'
# Linda adds a comment.
curl -s -X POST $B/reports/$R/approve "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: a-3' \
  -d '{"version":3,"comment":"Good work"}' | jq .error.code
```

Expected: `"REPORT_APPROVAL_FORBIDDEN"` (`403`); `"REPORT_VERSION_CONFLICT"` with
`currentVersion` 3 (`409`); `"VALIDATION_FAILED"` (`400`). The report is still `SUBMITTED` at
version 3.

## 4. Linda approves (US1; PRD row "Linda approves Mark's report")

```bash
curl -s -X POST $B/reports/$R/approve "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: a-4' \
  -d '{"version":3}' | tee /tmp/approved.json | jq '{status, version, transitions}'
curl -s $B/worksites/$W "${LINDA[@]}" | jq '.tasks[] | {name, approvedProgress}'
```

Expected: `200`; `APPROVED`, version 4, two transitions oldest first, the second `SUBMITTED` →
`APPROVED` by Linda with `reason` null. The townhouse shows Build ground-floor walls 55, Pour
foundation 100, Install electrical 0 (SC-001).

## 5. Retries and finality (US3, US4)

```bash
# The same request again: the stored answer.
diff <(curl -s -X POST $B/reports/$R/approve "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: a-4' \
  -d '{"version":3}' | jq -S .) <(jq -S . /tmp/approved.json) && echo identical
# Approve again from the current version, with a new key.
curl -s -X POST $B/reports/$R/approve "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: a-5' \
  -d '{"version":4}' | jq '.error | {code, details}'
# Mark tries to edit the approved report.
curl -s -X PUT $B/worksites/$W/reports/2026-11-20 "${MARK[@]}" "${JSON[@]}" -H 'Idempotency-Key: a-6' \
  -d "{\"version\":4,\"items\":[{\"taskId\":\"$WALLS\",\"reportedProgress\":60}]}" | jq .error.code
```

Expected: `identical`; `INVALID_STATUS_TRANSITION` with `from` `APPROVED` (`409`);
`REPORT_NOT_EDITABLE` (`409`). Walls is still 55.

## 6. Out-of-date-order approval (US2)

```bash
# Mark reports walls at 56% for 19 November (above today's 55%, so the submit is accepted).
curl -s -X PUT $B/worksites/$W/reports/2026-11-19 "${MARK[@]}" "${JSON[@]}" -H 'Idempotency-Key: o-1' \
  -d "{\"items\":[{\"taskId\":\"$WALLS\",\"reportedProgress\":56}]}" | tee /tmp/r19.json > /dev/null
R19=$(jq -r .id /tmp/r19.json)
curl -s -X POST $B/reports/$R19/submit "${MARK[@]}" "${JSON[@]}" -H 'Idempotency-Key: o-2' -d '{"version":1}' > /dev/null
# Mark reports walls at 70% for 21 November, and Linda approves it first.
curl -s -X PUT $B/worksites/$W/reports/2026-11-21 "${MARK[@]}" "${JSON[@]}" -H 'Idempotency-Key: o-3' \
  -d "{\"items\":[{\"taskId\":\"$WALLS\",\"reportedProgress\":70}]}" | tee /tmp/r21.json > /dev/null
R21=$(jq -r .id /tmp/r21.json)
curl -s -X POST $B/reports/$R21/submit "${MARK[@]}" "${JSON[@]}" -H 'Idempotency-Key: o-4' -d '{"version":1}' > /dev/null
curl -s -X POST $B/reports/$R21/approve "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: o-5' -d '{"version":2}' | jq .status
# Now the 19th.
curl -s -X POST $B/reports/$R19/approve "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: o-6' \
  -d '{"version":2}' | jq '.error | {code, message, details}'
```

Expected: `"APPROVED"`; then `422 REPORT_PROGRESS_OUTDATED`, `details.tasks` with Build ground-floor
walls, reported 56, approved 70. The report for the 19th is still `SUBMITTED` at version 2, and
walls is 70 (BR-5, BR-9).

The dates must be within the backdating limit on the day you run this; with the 365-day default
they are until November 2027.

## 7. Manual walkthrough

`http/report-flow.http` continues 002's requests with Linda approving Mark's report and viewing the
townhouse, as in section 4 (FR-021; SC-008).
