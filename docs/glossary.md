# Glossary

The shared vocabulary of the product documents and the code. A term is spelled the same way everywhere. Rule IDs refer to [use-cases.md](./product/use-cases.md).

## People

| Term | Definition | In code |
| --- | --- | --- |
| Actor | The user making the current request, with a role | `Actor` |
| Foreman | The role that leads the work on tasks and reports their progress | `Role.FOREMAN` |
| Site Supervisor | The role in charge of a worksite: creates tasks, assigns foremen, approves or rejects reports | `Role.SITE_SUPERVISOR` |
| Assignee | The one foreman responsible for a task | `task.assigneeId` |
| Author | The foreman who created a daily report | `report.authorId` |

## Things

| Term | Definition | In code |
| --- | --- | --- |
| Worksite | A construction site under way. Has one site supervisor and many tasks. Its status is `ACTIVE` or `CLOSED` | `Worksite` |
| Task | A unit of construction work within a worksite | `Task` |
| Daily Report | One foreman's record of progress for one worksite on one work date | `DailyReport` |
| Report Item | The progress of one task within a daily report | `ReportItem` |
| Work date | The calendar date a report describes. A date with no time component | `WorkDate`, `report.workDate` |
| Progress | An integer from 0 to 100, in percent, cumulative | `Progress` |
| Reported progress | The progress a foreman states for a task in a report item, as of the end of the work date. It is not the amount added that day | `item.reportedProgress` |
| Approved progress | The official progress of a task. Changes only when a report is approved | `task.approvedProgress` |

## Lifecycle

| Term | Definition | In code |
| --- | --- | --- |
| Report status | One of `DRAFT`, `SUBMITTED`, `REJECTED`, `APPROVED` | `ReportStatus` |
| Submit | The foreman hands a report over for review. `DRAFT` or `REJECTED` to `SUBMITTED` | `report.submit()` |
| Approve | The site supervisor accepts a report, and approved progress is updated. `SUBMITTED` to `APPROVED` | `report.approve()` |
| Reject | The site supervisor sends a report back with a reason. `SUBMITTED` to `REJECTED` | `report.reject()` |
| Transition | A recorded change of report status: who, when, and why | `ReportTransition` |

## Technical terms used in the rules

| Term | Definition | In code |
| --- | --- | --- |
| Request key | A unique value sent with a write request so that a retry is recorded once (BR-14) | `Idempotency-Key` header |
| Version | A counter on a report that increases with every write. Used to detect stale copies (BR-15) | `report.version` |
| Backdating limit | How many days before today a report can be created for (BR-2) | `BACKDATE_LIMIT_DAYS` |
