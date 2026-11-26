# Quickstart: validate Reject and resubmit

Runnable checks that prove the feature works end to end, and the whole PRD example by hand. The
endpoint is in [contracts/reject-report.md](./contracts/reject-report.md); the example IDs are in
[002's data-model.md](../002-draft-and-submit/data-model.md), section 5; Henry's versions are in
[data-model.md](./data-model.md), section 5.

## Prerequisites

- Everything in [002's quickstart](../002-draft-and-submit/quickstart.md), Prerequisites.
- Features 002 and 003 committed (through `fdd369a`).

## 1. Automated checks

```bash
npm run check        # typecheck, Biome, dependency-cruiser, unit tests
npm run test:all     # unit, integration, API
npm run test:cov     # domain and application at or above 90%
```

Expected: every command exits 0.
`grep -rhoE "BR-(6|8|10|11|12|15)\b" test/unit/modules/reporting test/integration test/api | sort -u`
lists all six rules this feature tests (TST-01).

## 2. Start the stack and run Mark's part

Run [002's quickstart](../002-draft-and-submit/quickstart.md) sections 2 and 3. They start the
stack from scratch (`migrate` now applies three migrations), set `B`, `W`, `WALLS`, `ELEC`, `MARK`,
`LINDA`, `JSON`, and leave Mark's report for 20 November in `$R`, `SUBMITTED` at version 3.

```bash
HENRY=(-H 'X-Actor-Id: 00000000-0000-4000-8000-000000000003' -H 'X-Actor-Role: FOREMAN')
progress() { curl -s $B/worksites/$W "${LINDA[@]}" | jq -c '[.tasks[] | {(.name): .approvedProgress}] | add'; }
```

## 3. Henry submits; Linda approves Mark's report (PRD rows 1 and 2)

```bash
curl -s -X PUT $B/worksites/$W/reports/2026-11-20 "${HENRY[@]}" "${JSON[@]}" -H 'Idempotency-Key: h-1' \
  -d "{\"items\":[{\"taskId\":\"$ELEC\",\"reportedProgress\":10}]}" | tee /tmp/h.json | jq '{status, version}'
H=$(jq -r .id /tmp/h.json)
curl -s -X POST $B/reports/$H/submit "${HENRY[@]}" "${JSON[@]}" -H 'Idempotency-Key: h-2' -d '{"version":1}' | jq .status
progress
curl -s -X POST $B/reports/$R/approve "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: h-3' -d '{"version":3}' | jq .status
progress
```

Expected: `DRAFT` 1; `"SUBMITTED"`; walls 40, electrical 0 (row 1); `"APPROVED"`; walls 55,
electrical 0 (row 2).

## 4. Refusals before the rejection (US1, US3)

```bash
# Henry rejects his own report.
curl -s -X POST $B/reports/$H/reject "${HENRY[@]}" "${JSON[@]}" -H 'Idempotency-Key: h-4' \
  -d '{"version":2,"reason":"x"}' | jq .error.code
# Linda gives no reason, then a blank one.
curl -s -X POST $B/reports/$H/reject "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: h-5' \
  -d '{"version":2}' | jq .error.code
curl -s -X POST $B/reports/$H/reject "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: h-6' \
  -d '{"version":2,"reason":"   "}' | jq .error.code
# Linda sends a reason over 2,000 characters.
curl -s -X POST $B/reports/$H/reject "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: h-7' \
  -d "{\"version\":2,\"reason\":\"$(printf 'a%.0s' {1..2001})\"}" | jq .error.code
# Linda rejects Mark's approved report.
curl -s -X POST $B/reports/$R/reject "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: h-8' \
  -d '{"version":4,"reason":"x"}' | jq '.error | {code, details}'
```

Expected: `"REPORT_REJECTION_FORBIDDEN"` (`403`); `"REJECTION_REASON_REQUIRED"` (`422`) twice;
`"VALIDATION_FAILED"` (`400`); `INVALID_STATUS_TRANSITION` with `from` `APPROVED` (`409`). Henry's
report is still `SUBMITTED` at version 2.

## 5. Linda rejects; Henry reads the reason, edits and resubmits (PRD rows 3 and 4)

```bash
curl -s -X POST $B/reports/$H/reject "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: h-9' \
  -d '{"version":2,"reason":"conduit laid, no wiring pulled yet"}' | tee /tmp/rejected.json \
  | jq '{status, version, last: .transitions[-1]}'
progress
curl -s $B/reports/$H "${HENRY[@]}" | jq '.transitions[-1].reason'
curl -s -X PUT $B/worksites/$W/reports/2026-11-20 "${HENRY[@]}" "${JSON[@]}" -H 'Idempotency-Key: h-10' \
  -d "{\"version\":3,\"items\":[{\"taskId\":\"$ELEC\",\"reportedProgress\":5}]}" | jq '{status, version}'
curl -s -X POST $B/reports/$H/submit "${HENRY[@]}" "${JSON[@]}" -H 'Idempotency-Key: h-11' -d '{"version":4}' | jq '{status, version}'
progress
curl -s -X POST $B/reports/$H/approve "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: h-12' -d '{"version":5}' \
  | jq '[.status, .version, [.transitions[] | [.fromStatus, .toStatus, .reason]]]'
progress
```

Expected:

- Rejection: `200`, `REJECTED`, version 3, last transition `SUBMITTED` → `REJECTED` by Linda with
  the reason. Progress walls 55, electrical 0 (row 3).
- Henry's view shows `"conduit laid, no wiring pulled yet"`.
- Save: `REJECTED`, version 4. Submit: `SUBMITTED`, version 5. Progress still 55, 0 (UC-4: no task
  changes before the final approval).
- Approval: `APPROVED`, version 6, four transitions: `DRAFT→SUBMITTED`, `SUBMITTED→REJECTED` with
  the reason, `REJECTED→SUBMITTED`, `SUBMITTED→APPROVED`. Progress walls 55, electrical 5 (row 4;
  SC-001).

## 6. Retry (US4)

```bash
diff <(curl -s -X POST $B/reports/$H/reject "${LINDA[@]}" "${JSON[@]}" -H 'Idempotency-Key: h-9' \
  -d '{"version":2,"reason":"conduit laid, no wiring pulled yet"}' | jq -S .) <(jq -S . /tmp/rejected.json) && echo identical
```

Expected: `identical`: the stored response, though the report has moved on to `APPROVED`. No new
transition (FR-017; SC-007).

## 7. Manual walkthrough

From a clean stack (`docker compose down -v`, then `docker compose up --build`), run
`http/report-flow.http` from top to bottom. The townhouse views it contains show, in order: 40/0,
40/0 after both submissions, 55/0, 55/0 after the rejection, 55/5 (FR-024; SC-009). README "Run it"
describes the same steps (FR-025).
