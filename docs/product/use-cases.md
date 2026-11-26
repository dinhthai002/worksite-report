# Use Cases

Each use case lists the rules it applies, then the acceptance criteria that go beyond a single rule: a requirement, a measurable bar, and how it is verified. Rule IDs refer to the [Business rules](#business-rules) section at the end of this document.

## UC-1: Draft a report

A foreman picks a worksite and a work date, enters progress for the tasks worked on, and saves a draft. A draft can be saved any number of times.

Applies: BR-1, BR-2, BR-3, BR-4, BR-5 (range only), BR-14, BR-15.

| Requirement | Bar | Verification |
| --- | --- | --- |
| The first save creates a report in `DRAFT` | Exactly 1 report for the foreman, worksite, and work date | Create, then count reports for that date |
| Repeating the same request creates no additional report | 5 identical requests yield 1 report and 5 identical responses | Repeat the request with the same request key |
| A save based on a stale version is rejected | 0 changes recorded | Save from two sessions. The second receives a conflict |

## UC-2: Submit a report

A foreman submits a draft or a rejected report for review.

Applies: BR-3, BR-4, BR-5, BR-6, BR-7, BR-11, BR-14, BR-15.

## UC-3: Approve a report

The site supervisor reviews a submitted report and approves it.

Applies: BR-5, BR-9, BR-10, BR-11, BR-12, BR-14, BR-15.

| Requirement | Bar | Verification |
| --- | --- | --- |
| A failure on one task changes no task | 0 tasks changed. Report still `SUBMITTED` | Force a failure mid-approval, then check |
| Of two simultaneous decisions, exactly one wins | 1 success, 1 conflict | Approve and reject concurrently |
| Only the worksite's supervisor can approve | Foreman: rejected. Supervisor of another worksite: rejected | Call approve as each of them |

## UC-4: Reject and resubmit

The site supervisor rejects a report with a reason. The foreman edits and resubmits.

Applies: BR-6, BR-8, BR-11, BR-12, BR-14, BR-15.

| Requirement | Bar | Verification |
| --- | --- | --- |
| Task progress does not change at any point in this flow | 0 tasks changed until the final approval | Compare progress after each step |
| The foreman can see the reason, edit, and resubmit | Report returns to `SUBMITTED` | Run the full cycle: reject, edit, submit, approve |

## UC-5: View a report

A user views one daily report, its items, and its history of status changes.

| Requirement | Bar | Verification |
| --- | --- | --- |
| The author can view their report in any status | Author: allowed | View as the author in each status |
| The worksite's site supervisor can view it once submitted | Supervisor: refused for `DRAFT`, allowed otherwise | View before and after submission |
| Nobody else can view it | Another foreman, a supervisor of another worksite: refused as not permitted | View as each of them |

## Business rules

Rule IDs are stable. Code and tests refer to rules by ID.

### Report validity

| ID | Rule | On violation |
| --- | --- | --- |
| BR-1 | A foreman has at most one report per worksite per work date. | Return the existing report. Do not create a new one. |
| BR-2 | The work date is not in the future and not more than 365 days before today. The limit is configurable, and "today" is evaluated in the system's configured time zone. | Reject, stating the valid date range. |
| BR-3 | Reports can be created and submitted only for an `ACTIVE` worksite. A report that was already `SUBMITTED` when the worksite was closed can still be approved or rejected. | Reject, stating that the worksite is closed. |
| BR-4 | A task appears at most once in a report, belongs to the report's worksite, and is currently assigned to the report's author. Assignment is checked on save and on submit, not on approval: a `SUBMITTED` report can still be approved or rejected after one of its tasks is reassigned. | Reject, naming the offending task. |
| BR-5 | Reported progress is an integer from 0 to 100 and is greater than or equal to the task's current approved progress. The reference is approved progress, not the previous day's report. | Reject, naming the task and its current approved progress. |

BR-5 is checked twice: when the report is submitted, and again when it is approved. The second check matters when reports are approved out of date order. If the report for the 20th is approved at 60% and the report for the 19th, at 40%, is put up for approval afterwards, the approval fails and the site supervisor must reject the report for the 19th.

### Lifecycle

| ID | Rule | On violation |
| --- | --- | --- |
| BR-6 | Only the author can edit a report, and only while it is `DRAFT` or `REJECTED`. | Reject, stating the current status. |
| BR-7 | A report must contain at least one item to be submitted. | Reject. |
| BR-8 | Rejecting a report requires a reason. | Reject the operation. |
| BR-9 | On approval, the approved progress of every task in the report is set to its reported progress. All updates succeed together or nothing changes. | The report remains `SUBMITTED`. |
| BR-10 | An `APPROVED` report is final. It cannot be edited or change status. | Reject. |
| BR-11 | Every status transition records who performed it, when (a timestamp with its time zone), and the reason if one was given. | Not applicable. |

### Permissions

| ID | Rule | On violation |
| --- | --- | --- |
| BR-12 | Only the site supervisor of a worksite can approve or reject that worksite's reports. | Reject as not permitted. |
| BR-13 | A task is assigned to exactly one foreman. Only the site supervisor of the worksite can assign or reassign it. Reassignment does not change existing reports. | Reject as not permitted. |

### Data integrity

| ID | Rule | On violation |
| --- | --- | --- |
| BR-14 | **Safe retries.** Every write request carries a unique request key. Repeating a request with the same key returns the original result and is recorded once. | Same key with different content: reject, stating that the key has been used. |
| BR-15 | **No silent overwrites.** Every edit and status transition states the version of the report the user last read. If the report has changed since, the operation is rejected. | Report a conflict and ask the user to reload the latest version. |
