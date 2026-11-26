# Worksite Report: PRD

Worksite Report tracks construction progress through daily reports. Foremen report progress on the tasks assigned to them. The site supervisor reviews each report, and task progress changes only when a report is approved.

Related documents:

- [Use cases](./use-cases.md): main flows, acceptance criteria, and business rules BR-1 to BR-15
- [Glossary](../glossary.md): definitions of every term used here

## Model

Terms are defined in the [glossary](../glossary.md).

```mermaid
erDiagram
    USER ||--o{ WORKSITE : "supervises"
    USER ||--o{ TASK : "is assigned"
    USER ||--o{ DAILY_REPORT : "authors"
    WORKSITE ||--o{ TASK : "has"
    WORKSITE ||--o{ DAILY_REPORT : "has"
    DAILY_REPORT ||--o{ REPORT_ITEM : "contains"
    TASK ||--o{ REPORT_ITEM : "progress of"

    WORKSITE {
        string name
        user supervisor
        enum status "ACTIVE or CLOSED"
    }
    TASK {
        string name
        user assignee "exactly one foreman"
        int approvedProgress "0 to 100"
    }
    DAILY_REPORT {
        date workDate
        user author
        string note
        enum status
    }
    REPORT_ITEM {
        int reportedProgress "0 to 100"
        string note
    }
```

The model rests on two figures. A foreman states **reported progress** in a report item, and the task keeps **approved progress**, which changes only when a report is approved. A task is complete when its approved progress is 100%.

## Report lifecycle

A report has four statuses and four valid transitions. Any other transition is rejected.

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> SUBMITTED: submit (foreman)
    SUBMITTED --> APPROVED: approve (site supervisor)
    SUBMITTED --> REJECTED: reject with reason (site supervisor)
    REJECTED --> SUBMITTED: edit and resubmit (foreman)
    APPROVED --> [*]
```

The author can edit a report only while it is `DRAFT` or `REJECTED`.

A rejected report does not return to `DRAFT`. The foreman edits it in the `REJECTED` status and resubmits, so the rejection reason stays in the report's history.

## Roles

There are two roles, and each user has exactly one, so the person who approves a report is never the person who wrote it.

| Action | Foreman | Site Supervisor |
| --- | --- | --- |
| Create a worksite | No | Yes, and becomes its supervisor |
| Create tasks and assign a foreman to each | No | Yes, in worksites they supervise |
| View worksites and tasks | Yes, any worksite, but only the tasks assigned to them | Yes, any worksite, with every task |
| View reports | Yes, their own reports | Yes, reports in worksites they supervise, once submitted |
| Create, edit, submit, and resubmit a report | Yes, their own report, on tasks assigned to them | No |
| Approve or reject a report | No | Yes, in worksites they supervise |

## Example: three-storey townhouse

Linda is the site supervisor. The worksite has three tasks assigned to two foremen.

| Task | Assignee | Approved progress |
| --- | --- | --- |
| Pour foundation | Mark | 100% |
| Build ground-floor walls | Mark | 40% |
| Install electrical | Henry | 0% |

At the end of 20 November, each foreman submits one report containing only the tasks worked on that day:

- **Mark's report:** Build ground-floor walls at 55%. Pour foundation is not in the report because it is complete.
- **Henry's report:** Install electrical at 10%.

Approved progress changes with each of Linda's decisions:

| Point in time | Build ground-floor walls | Install electrical |
| --- | --- | --- |
| Both reports submitted, none approved | 40% | 0% |
| Linda approves Mark's report | 55% | 0% |
| Linda rejects Henry's report. Reason: conduit laid, no wiring pulled yet | 55% | 0% |
| Henry changes the figure to 5% and resubmits. Linda approves | 55% | 5% |

On 21 November, Mark cannot report Build ground-floor walls below 55%, and cannot report Install electrical because that task is assigned to Henry.

## Implementation goals

1. **Safe retries.** A request repeated because of a network failure never creates a duplicate report (BR-14).
2. **No silent overwrites.** A write based on a stale copy of a report is rejected, and the user is told (BR-15).
3. **Atomic approval.** Approving a report updates the progress of every task in it, or changes nothing (BR-9).

## Out of scope

- Authentication and account management. The caller's identity and role are supplied with each request.
- Photos, attachments, and drawings.
- Notifications (email, push).
- A project manager role with a read-only view across worksites.
- Multiple companies and subcontractors.
- Attendance, materials, and cost tracking.
- User interface.
- Withdrawing or editing a submitted report. Only a rejection by the site supervisor reopens it.
- Lowering a task's approved progress, including a correction by the site supervisor.
