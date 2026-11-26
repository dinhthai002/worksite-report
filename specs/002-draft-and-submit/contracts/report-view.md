# Contract: the report response

Every endpoint of this feature that succeeds returns a Daily Report in this shape (FR-029, FR-031,
FR-034; API-04). Field names are `camelCase`, dates `YYYY-MM-DD`, timestamps ISO 8601 with offset
(architecture.md, section 4.1).

```json
{
  "id": "5f0c8a52-3d55-4c3e-9a0e-2b7f8f4f9b11",
  "worksiteId": "00000000-0000-4000-8000-000000000101",
  "authorId": "00000000-0000-4000-8000-000000000002",
  "workDate": "2026-11-20",
  "status": "SUBMITTED",
  "version": 3,
  "note": "Rain stopped work at 15:00.",
  "items": [
    {
      "taskId": "00000000-0000-4000-8000-000000000202",
      "reportedProgress": 55,
      "note": "East and north walls up to lintel height."
    }
  ],
  "transitions": [
    {
      "fromStatus": "DRAFT",
      "toStatus": "SUBMITTED",
      "actorId": "00000000-0000-4000-8000-000000000002",
      "occurredAt": "2026-11-20T10:05:12.345Z",
      "reason": null
    }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Report ID, generated on the first save |
| `worksiteId` | UUID | |
| `authorId` | UUID | User identifier only; no name or role (FR-031) |
| `workDate` | `YYYY-MM-DD` | |
| `status` | `"DRAFT"` \| `"SUBMITTED"` \| `"REJECTED"` \| `"APPROVED"` | |
| `version` | integer ≥ 1 | Send it back with the next save or submission (BR-15) |
| `note` | string (≤ 2,000) \| `null` | |
| `items` | array | Possibly empty. Last changed first, then first created, then `taskId` (FR-032) |
| `items[].taskId` | UUID | |
| `items[].reportedProgress` | integer 0 to 100 | |
| `items[].note` | string (≤ 2,000) \| `null` | |
| `transitions` | array | Empty until the first submission. Oldest first (FR-032, recorded exception) |
| `transitions[].fromStatus`, `toStatus` | status | |
| `transitions[].actorId` | UUID | |
| `transitions[].occurredAt` | ISO 8601 timestamp, UTC (`Z`) | research R14 |
| `transitions[].reason` | string \| `null` | Always `null` for a submission |
