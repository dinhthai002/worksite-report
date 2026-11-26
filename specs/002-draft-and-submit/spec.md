# Feature Specification: Draft and submit a daily report

**Feature Branch**: `002-draft-and-submit`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "002-draft-and-submit"

**Source**: [Implementation plan, Step 2](../../docs/engineering/implementation-plan.md#step-2-002-draft-and-submit). Related: [Use cases](../../docs/product/use-cases.md) (UC-1, UC-2, business rules), [PRD](../../docs/product/prd.md) (Report lifecycle, Roles, Example, Implementation goals 1 and 2), [Glossary](../../docs/glossary.md), [Feature 001](../001-worksite-seed/spec.md).

**Business rules implemented**: BR-1, BR-2, BR-3, BR-4, BR-5 (range on save, approved progress on submit), BR-6, BR-7, BR-11 (first transition: submission), BR-14, BR-15. BR-5 at approval, BR-8 to BR-10, BR-12 and BR-13 belong to features 003 to 005.

## Clarifications

### Session 2026-11-26

- Q: When someone asks to view a daily report, who is allowed to see it? → A: The author, in any status. The worksite's Site Supervisor, in any status except `DRAFT`. Anyone else, and the Site Supervisor asking for a `DRAFT`, is refused as not permitted (not as not found).
- Q: The PRD example reports on 20 November, but from today (26 November) that date is outside the 5-day backdating limit. How should the manual walkthrough get a work date that works? → A: Keep 20 November 2026. The system's default backdating limit becomes 365 days, which includes it, so the walkthrough needs no special setting. (First answered as a 3650-day limit for the walkthrough only, with the default staying 5 days; changed after planning to a 365-day default for every environment.)
- Q: When a report's history of status changes is shown, should the oldest change be listed first, or the most recent? → A: Oldest first, as a timeline. This is a recorded exception to feature 001's ordering rule. Report items still follow that rule, most recently changed first.
- Q: When a Foreman saves a draft again, does the save replace the report's whole list of tasks and progress, or does it only add or change the tasks it includes? → A: Each save replaces the whole list. A task left out of the save is removed from the report.
- Q: Should a daily report and each of its task entries be able to carry a written note, and if so, is a note optional and how long can it be? → A: Both notes are optional, plain text, up to 2,000 characters each.

## User Scenarios & Testing *(mandatory)*

People are named for readability, as in the PRD example (Linda: Site Supervisor; Mark and Henry: Foremen; worksite "Three-storey townhouse"; tasks Pour foundation (Mark, 100%), Build ground-floor walls (Mark, 40%), Install electrical (Henry, 0%)). Unless a scenario says otherwise, the worksite is `ACTIVE`, the backdating limit is the default 365 days, and "today" is 21 November 2026, so 20 November 2026 is a valid work date.

### User Story 1 - Draft a report (Priority: P1)

UC-1. A Foreman picks a worksite and a work date, enters progress for the tasks worked on, and saves a draft. The first save creates the Daily Report in `DRAFT`. The Foreman can save it again any number of times, changing items, progress and notes, until it is submitted. Every save checks that the work date is allowed (BR-2), the worksite is `ACTIVE` (BR-3), each task is listed once, belongs to the worksite and is assigned to the Foreman (BR-4), and each reported progress is an integer from 0 to 100 (BR-5, range only).

**Why this priority**: Nothing else in the reporting flow exists without a report. Drafting is where the Foreman's data enters the system, and where most mistakes are caught early.

**Independent Test**: As Mark, save a draft for the townhouse and 20 November with Build ground-floor walls at 55%. Save it again with 60%. Check that exactly one report exists for Mark, the townhouse and 20 November, in `DRAFT`, with 60%, and that the approved progress of every task is unchanged. Then try each rule violation and check that each is refused with the stated reason and changes nothing.

**Acceptance Scenarios**:

1. **Given** Mark has no report for the townhouse on 20 November, **When** Mark saves a draft with Build ground-floor walls at 55%, **Then** one report is created in `DRAFT`, authored by Mark, for the townhouse and 20 November, with one item at 55%, and its version is returned.
2. **Given** Mark's draft from scenario 1 and its current version, **When** Mark saves it again with Build ground-floor walls at 60% and that version, **Then** the same report now holds 60%, its version has increased, and no second report exists.
3. **Given** Mark's draft already exists, **When** Mark sends a first save for the townhouse and 20 November without a version (for example from a second device), **Then** no new report is created, the existing report is returned unchanged with its current version, and the content of that request is not applied (BR-1).
4. **Given** today is 21 November 2026, **When** Mark saves a draft for 22 November 2026, **Then** the save is refused and the message states the valid date range, 21 November 2025 to 21 November 2026 (BR-2).
5. **Given** today is 21 November 2026 and the limit is 365 days, **When** Mark saves a draft for 21 November 2025, **Then** it is accepted; **When** Mark saves one for 20 November 2025, **Then** it is refused, stating the valid range (BR-2).
6. **Given** the system's time zone is seven hours ahead of UTC, and the current instant is 18:30 UTC on 20 November (01:30 on 21 November in the system's time zone), **When** Mark saves a draft for 21 November, **Then** it is accepted, because today is 21 November in the system's time zone (BR-2).
7. **Given** a `CLOSED` worksite, **When** a Foreman with a task there saves a draft for it, **Then** the save is refused, stating that the worksite is closed (BR-3).
8. **Given** a draft listing Build ground-floor walls twice, **When** Mark saves it, **Then** it is refused, naming Build ground-floor walls (BR-4).
9. **Given** a draft containing Install electrical, which is assigned to Henry, **When** Mark saves it, **Then** it is refused, naming Install electrical (BR-4). This is the PRD example's "cannot report Install electrical because that task is assigned to Henry".
10. **Given** a draft containing a task of another worksite, **When** Mark saves it for the townhouse, **Then** it is refused, naming that task (BR-4).
11. **Given** a draft with Build ground-floor walls at 101%, or at -1%, **When** Mark saves it, **Then** it is refused, naming the task and the allowed range 0 to 100 (BR-5).
12. **Given** a draft with Build ground-floor walls at 30%, below its approved progress of 40%, **When** Mark saves it, **Then** the save is accepted, because the comparison with approved progress happens on submit (BR-5).
13. **Given** Mark's draft, **When** Mark saves it with no items, **Then** the save is accepted and the draft holds no items (BR-7 applies only on submit).
14. **Given** Linda, a Site Supervisor, **When** Linda tries to save a draft, **Then** the save is refused as not permitted, because only a Foreman creates and edits reports (PRD, Roles).
15. **Given** any save is refused, **When** the report is viewed, **Then** it is exactly as it was before that save: no item, progress, note or version has changed.
16. **Given** Mark's draft holds Pour foundation at 100% and Build ground-floor walls at 55%, **When** Mark saves it with only Build ground-floor walls at 55% and the current version, **Then** the draft holds only Build ground-floor walls; Pour foundation is no longer in the report (FR-002).

---

### User Story 2 - Submit a report for review (Priority: P1)

UC-2. The Foreman submits a draft, or a rejected report, for the Site Supervisor's review. Submitting moves the report to `SUBMITTED` and records who submitted it and when (BR-11). Before it does, the system checks again that the worksite is `ACTIVE` (BR-3), that every task is still assigned to the author (BR-4), that every reported progress is at least the task's current approved progress (BR-5), and that the report has at least one item (BR-7). Submitting never changes approved progress: that happens only on approval (feature 003).

**Why this priority**: Submission hands the work to the Site Supervisor. Without it, the drafting in User Story 1 has no outcome, and features 003 and 004 have nothing to approve or reject.

**Independent Test**: As Mark, draft Build ground-floor walls at 55% for 20 November and submit it with the current version. Check that the report is `SUBMITTED`, that its history holds one transition from `DRAFT` to `SUBMITTED` by Mark with a time, and that Build ground-floor walls still has approved progress 40%. Then try each refusal and check the report has not changed.

**Acceptance Scenarios**:

1. **Given** Mark's draft with Build ground-floor walls at 55% and its current version, **When** Mark submits it, **Then** the report is `SUBMITTED`, its version has increased, and one transition is recorded: from `DRAFT` to `SUBMITTED`, by Mark, at the time of submission with its time zone, and no reason (BR-11).
2. **Given** Mark's report has been submitted, **When** anyone views Build ground-floor walls, **Then** its approved progress is still 40%.
3. **Given** Mark's draft with no items, **When** Mark submits it, **Then** it is refused, stating that a report needs at least one item, and it stays `DRAFT` (BR-7).
4. **Given** Mark's draft with Build ground-floor walls at 30%, **When** Mark submits it, **Then** it is refused, naming Build ground-floor walls and its current approved progress, 40% (BR-5).
5. **Given** Mark's draft with Build ground-floor walls at 40%, equal to its approved progress, **When** Mark submits it, **Then** it is accepted (BR-5: greater than or equal).
6. **Given** Mark's draft is saved and its worksite is then closed, **When** Mark submits it, **Then** it is refused, stating that the worksite is closed, and it stays `DRAFT` (BR-3).
7. **Given** Mark's draft includes Build ground-floor walls and that task is then reassigned to Henry, **When** Mark submits it, **Then** it is refused, naming Build ground-floor walls (BR-4).
8. **Given** Mark's report is `SUBMITTED`, **When** Mark saves changes to it or submits it again, **Then** each is refused, stating the current status, `SUBMITTED` (BR-6, Report lifecycle).
9. **Given** Mark's report is `APPROVED`, **When** Mark saves changes to it or submits it, **Then** each is refused, stating the current status, `APPROVED` (BR-6).
10. **Given** Mark's report is `REJECTED` (set up directly; rejecting is added in feature 004), **When** Mark saves changes to it with the current version, **Then** the changes are kept and the report stays `REJECTED`; **When** Mark then submits it, **Then** it becomes `SUBMITTED` and a transition from `REJECTED` to `SUBMITTED` is recorded (BR-6, BR-11).
11. **Given** Mark's draft, **When** Henry, another Foreman, submits it, **Then** the submission is refused as not permitted, and it stays `DRAFT` (BR-6).
12. **Given** Mark's draft, **When** Linda submits it, **Then** the submission is refused as not permitted (PRD, Roles).
13. **Given** a report identifier that does not exist, **When** a Foreman submits it, **Then** the request is refused as not found.

---

### User Story 3 - Retries never duplicate, and stale copies never overwrite (Priority: P1)

PRD implementation goals 1 and 2. A Foreman on a weak connection may send the same request several times. Every save and every submission carries a request key chosen by the caller. Repeating a request with the same key returns the original result and records the change once (BR-14). Every change to an existing report also states the version the Foreman last read; if the report has changed since, the change is refused and the Foreman is asked to reload (BR-15). These are the acceptance criteria of UC-1.

**Why this priority**: These are two of the PRD's three implementation goals and two of the three acceptance criteria of UC-1. Without them, a retry can create duplicate reports and a second device can silently overwrite the first.

**Independent Test**: Send the same first save five times with the same request key, and check that there is one report and five identical responses. Then send two saves based on the same version; check that one is kept and the other is refused as a conflict that gives the current version, and that the refused one changed nothing.

**Acceptance Scenarios**:

1. **Given** Mark has no report for 20 November, **When** Mark sends the same first save five times with the same request key, **Then** exactly one report exists and all five responses are identical (UC-1 acceptance).
2. **Given** a submission has succeeded, **When** Mark repeats it with the same request key, **Then** the original response is returned, the report is still `SUBMITTED`, and only one transition is recorded.
3. **Given** a request key Mark has already used, **When** Mark sends a different request with that key, **Then** it is refused, stating that the key has already been used, and nothing changes (BR-14).
4. **Given** a request is still being processed, **When** the same request with the same key arrives, **Then** the second is refused, stating that the original request is still in progress and can be retried later. When the first completes, a retry returns its result.
5. **Given** Mark and Henry both use the same request key value, **When** each sends a request, **Then** both are processed independently, because a key belongs to the user who sent it.
6. **Given** a save or submission without a request key, **When** it is sent, **Then** it is refused as an invalid request, stating that a request key is required.
7. **Given** Mark reads the draft at version 2 on two devices, **When** both devices save from version 2, **Then** exactly one save is kept; the other is refused as a conflict, states the report's current version, asks Mark to reload it, and changes nothing (UC-1 acceptance, BR-15).
8. **Given** Mark's draft has been saved since Mark last read it, **When** Mark submits it with the older version, **Then** the submission is refused as a conflict and the report stays `DRAFT` (BR-15).
9. **Given** Mark has no report for 20 November, **When** two different first saves for the same worksite and work date arrive at the same moment, **Then** exactly one report is created; the other request receives the existing report, and its content is not applied (BR-1).

---

### User Story 4 - View a report and its history (Priority: P2)

A user views one Daily Report: its worksite, author, work date, status, version, note, its items with their reported progress and notes, and its history of transitions. The Foreman needs this to continue a draft and to send the right version with the next change. The Site Supervisor needs it to review the report in feature 003.

**Why this priority**: Saving and submitting can be tested through their own responses, so this story is not needed first. But a Foreman who changes device, or a Site Supervisor reviewing a report, has no other way to read it.

**Independent Test**: Draft and submit Mark's report, then view it and check every field against what was saved, including the one transition and the current version. View an identifier that does not exist and check that it is refused as not found.

**Acceptance Scenarios**:

1. **Given** Mark's submitted report, **When** Mark views it, **Then** Mark sees the worksite, Mark as author (by user identifier), 20 November, `SUBMITTED`, the current version, the report note, the item Build ground-floor walls at 55% with its note, and one transition from `DRAFT` to `SUBMITTED` by Mark with its time and time zone.
2. **Given** Mark's draft that has not been submitted, **When** Mark views it, **Then** Mark sees it in `DRAFT` with an empty history.
3. **Given** a report identifier that does not exist, **When** a known user views it, **Then** the request is refused as not found.
4. **Given** Mark's submitted report, **When** Linda, the townhouse's Site Supervisor, views it, **Then** Linda sees it as in scenario 1.
5. **Given** Mark's draft that has not been submitted, **When** Linda views it, **Then** the request is refused as not permitted.
6. **Given** Mark's report in any status, **When** Henry, another Foreman, or the Site Supervisor of another worksite views it, **Then** the request is refused as not permitted.
7. **Given** any report, **When** it is viewed, **Then** no data changes.

---

### Edge Cases

- **Version sent for a report that does not exist**: a save that states a version, for a worksite and work date where the caller has no report, is refused as a conflict, so the caller reloads instead of creating a report it did not mean to.
- **Version missing on a change**: a save to an existing report is a first save without a version (BR-1, scenario US1-3). A submission without a version is refused as an invalid request.
- **A different Foreman, same date**: Henry saving a draft for the townhouse on 20 November creates Henry's own report. BR-1 limits one report per Foreman, worksite and work date, not one per worksite and date. Henry can never reach Mark's report through a save, only Henry's own.
- **Foreman with no task in the worksite**: may save an empty draft, but every item they add is refused by BR-4, so the draft can never be submitted (BR-7).
- **Work date passes the backdating limit after the report exists**: the limit applies when the report is created (glossary, Backdating limit). An existing draft can still be saved and submitted after its work date falls outside the limit, and a rejected report can be resubmitted.
- **Worksite closed after a report is submitted**: no effect in this feature. BR-3 lets a `SUBMITTED` report still be approved or rejected (features 003 and 004).
- **Work date that is not a calendar date** (for example 30 February) or not in the date format: refused as an invalid request, stating the expected format.
- **Progress that is not a whole number** (for example 55.5): refused as an invalid request.
- **Note length**: a note of exactly 2,000 characters is accepted; one of 2,001 characters is refused as an invalid request (FR-002a). A save with no notes at all is accepted.
- **Unknown task or worksite identifier**: a task identifier that is not a task of the report's worksite is refused by BR-4, naming it. A worksite identifier that does not exist is refused as not found.
- **Several violations in one save**: the save is refused as a whole. The response names at least the first offending task or condition, and nothing is applied.
- **A refused or failed request and its key**: a request that is refused or fails is not recorded against its request key. Sending it again with the same key is processed afresh (implementation plan, section 3).
- **Transitions are permanent**: a recorded transition can never be changed or removed, by any part of the system.
- **Transitions other than submit**: the lifecycle has exactly four valid transitions (PRD, Report lifecycle). Every other pair of statuses is refused, including a status to itself. Only `DRAFT` to `SUBMITTED` and `REJECTED` to `SUBMITTED` can be triggered in this feature.

## Requirements *(mandatory)*

### Functional Requirements

**Saving a draft (UC-1)**

- **FR-001**: A Foreman MUST be able to save a Daily Report for a worksite and a work date. The first save MUST create the report in `DRAFT`, with the caller as author.
- **FR-002**: A save MUST carry the complete list of items, each with a task, a reported progress and an optional note, plus an optional report note. The saved list MUST replace the report's previous items: a task left out of a save is no longer in the report.
- **FR-002a**: The report note and each item's note MUST be optional plain text of at most 2,000 characters. A longer note MUST be refused as an invalid request, stating the limit and, for an item note, naming the task.
- **FR-003**: A Foreman MUST have at most one report per worksite per work date. A first save for a worksite and work date where the caller already has a report MUST return that report unchanged, with its current version, and MUST NOT apply the request's content (BR-1). This MUST hold when two first saves arrive at the same time.
- **FR-004**: The work date of a new report MUST NOT be after today, and MUST NOT be more than the backdating limit (default 365 days) before today. Today is the calendar date in the system's configured time zone. The boundary date is accepted. A refusal MUST state the earliest and latest valid dates (BR-2).
- **FR-005**: A save MUST be refused when the worksite is not `ACTIVE`, stating that the worksite is closed (BR-3).
- **FR-006**: Each task in a save MUST appear once, belong to the report's worksite, and be assigned to the author at the time of the save. A refusal MUST name the offending task (BR-4).
- **FR-007**: Each reported progress MUST be a whole number from 0 to 100. A refusal MUST name the task and the allowed range. A save MUST NOT compare reported progress with approved progress (BR-5, range only).
- **FR-008**: A report MUST be changed only by its author, and only while it is `DRAFT` or `REJECTED`. A refusal for status MUST state the current status. Saving MUST NOT change the status (BR-6).
- **FR-009**: A save that is refused MUST change nothing. A save that is kept MUST apply all its changes together.

**Submitting (UC-2)**

- **FR-010**: The author MUST be able to submit a report that is `DRAFT` or `REJECTED`. Submitting MUST move it to `SUBMITTED` and MUST NOT change its items.
- **FR-011**: Submitting MUST be refused, stating the current status, when the report is `SUBMITTED` or `APPROVED` (BR-6, Report lifecycle).
- **FR-012**: Submitting MUST be refused when the report has no items (BR-7).
- **FR-013**: Submitting MUST be refused when the worksite is not `ACTIVE`, stating that the worksite is closed (BR-3).
- **FR-014**: Submitting MUST check again that every task is assigned to the author, and refuse naming the task otherwise (BR-4).
- **FR-015**: Submitting MUST be refused when any reported progress is below the task's current approved progress, naming the task and its current approved progress (BR-5).
- **FR-016**: Submitting MUST NOT change any task's approved progress.
- **FR-017**: A user other than the author, of either role, MUST be refused as not permitted when submitting (BR-6; PRD, Roles).

**Lifecycle and history (BR-11)**

- **FR-018**: The system MUST know the full report lifecycle of the PRD: `DRAFT` to `SUBMITTED`, `SUBMITTED` to `APPROVED`, `SUBMITTED` to `REJECTED`, `REJECTED` to `SUBMITTED`. Every other pair of statuses, including a status to itself, MUST be refused.
- **FR-019**: Every status transition MUST be recorded with the status before and after, who performed it, when, as a timestamp with its time zone, and the reason if one was given (BR-11). Creating a draft is not a transition; a report's first transition is its first submission.
- **FR-020**: A recorded transition MUST never be changed or removed. The stored data itself MUST refuse such a change.

**Safe retries (BR-14)**

- **FR-021**: Every save and every submission MUST carry a request key. A request without one MUST be refused as invalid.
- **FR-022**: Repeating a request with the same key and the same content, by the same user, MUST return the original result and MUST NOT record the change again.
- **FR-023**: A request that reuses a user's key with different content MUST be refused, stating that the key has already been used, and MUST change nothing.
- **FR-024**: A request whose key is still being processed for that user MUST be refused, stating that the original request is still in progress.
- **FR-025**: A request key MUST belong to the user who sent it: the same key from two users identifies two different requests.
- **FR-026**: A request that is refused or fails MUST NOT be recorded against its key, so that sending it again is processed afresh.

**No silent overwrites (BR-15)**

- **FR-027**: Every save to an existing report, and every submission, MUST state the version of the report the caller last read. If the report has changed since, the request MUST be refused as a conflict that gives the current version and asks the caller to reload, and MUST change nothing.
- **FR-028**: Every kept save and every transition MUST increase the report's version.
- **FR-029**: Every response that returns a report MUST include its current version.

**Viewing a report**

- **FR-030**: The author MUST be able to view their report in any status. The Site Supervisor of the report's worksite MUST be able to view it in every status except `DRAFT`. Every other user, and the worksite's Site Supervisor asking for a `DRAFT`, MUST be refused as not permitted.
- **FR-031**: The report view MUST include the report's identifier, worksite identifier, author's user identifier, work date, status, version and note; each item's task identifier, reported progress and note; and each transition's statuses, actor's user identifier, time with time zone, and reason. It MUST NOT include user names or roles (as in feature 001).
- **FR-032**: Items MUST be listed by the ordering rule of feature 001: last-changed time, most recent first, then creation time, oldest first, then identifier. Transitions MUST be listed oldest first, by the time they were recorded, then by identifier. This is a recorded exception to feature 001's rule (Clarifications).
- **FR-033**: Viewing a report identifier that does not exist MUST be refused as not found. Viewing MUST NOT change any data.
- **FR-034**: The responses to a save and to a submission MUST return the report as FR-031 describes it.

**Permissions and errors**

- **FR-035**: A Site Supervisor MUST be refused as not permitted when saving or submitting a report (PRD, Roles).
- **FR-036**: Every refusal in this feature MUST use the shared error shape from feature 001 (FR-020 there): a stable code, a message that says what went wrong and how to fix it, and optional details such as the offending task, the valid date range, the current status or the current version.

**Walkthrough**

- **FR-037**: The manual walkthrough MUST let a person reproduce the PRD example for Mark: draft Build ground-floor walls at 55%, edit it, and submit it, then see that its approved progress is still 40%. The work date MUST be 20 November 2026, as in the PRD example.
- **FR-037a**: The system's default backdating limit MUST be 365 days, in every environment, including the one started for the walkthrough. No environment needs a special value for the walkthrough. The automated tests MUST check BR-2 with the default.

### Key Entities

- **Daily Report**: one Foreman's record of progress for one worksite on one work date. Has an author (a Foreman), a worksite, a work date, a status (`DRAFT`, `SUBMITTED`, `REJECTED`, `APPROVED`), a version, an optional note, many report items and a history of transitions. At most one per author, worksite and work date (BR-1).
- **Report Item**: the reported progress of one task within a Daily Report, with an optional note. A task appears at most once per report (BR-4). Reported progress is cumulative, as of the end of the work date (glossary).
- **Transition**: a recorded change of report status: from and to status, who, when (with time zone), and an optional reason. Permanent once recorded (BR-11).
- **Request key record**: the record that a user's request with a given key was received, what its content was, and, once completed, the result to return on a repeat (BR-14).
- **Worksite and Task** (from feature 001, read only here): the worksite's status (BR-3), and each task's worksite, assignee and approved progress (BR-4, BR-5).
- **Every entity above** records when it was created and when it was last changed (feature 001, FR-015a).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Foreman can draft, edit and submit the PRD example report (Build ground-floor walls at 55%) in 3 requests, and after submission 0 tasks have a changed approved progress.
- **SC-002**: 5 identical save requests with the same request key yield exactly 1 report and 5 identical responses (UC-1 acceptance).
- **SC-003**: Of 2 saves based on the same version, exactly 1 is kept and 1 is refused as a conflict, and the refused save records 0 changes (UC-1 acceptance).
- **SC-004**: With 10 first saves for the same Foreman, worksite and work date sent at the same moment, exactly 1 report exists afterwards (BR-1).
- **SC-005**: 100% of refusals for BR-2 to BR-7 state the reason a Foreman needs to correct the report: the valid date range, the closed worksite, the offending task, the task's approved progress, the current status, or the missing items. 0 refused requests change any data.
- **SC-006**: Every submission records exactly 1 transition with its actor and time, and 0 recorded transitions can be changed or removed afterwards.
- **SC-007**: Each of the 16 pairs of report statuses is either one of the 4 transitions in the PRD lifecycle or refused, with no exceptions.
- **SC-008**: A person new to the project can draft, edit and submit Mark's report by following only the setup instructions and the manual walkthrough.

## Assumptions

### Scope boundaries

- In scope: UC-1 Draft a report, UC-2 Submit a report, viewing one report with its items and history, and the safe-retry and stale-copy protections for those writes.
- Out of scope: approving (feature 003) and rejecting (feature 004) reports; listing or searching reports; deleting or withdrawing a report (PRD, Out of scope: "Withdrawing or editing a submitted report"); reassigning tasks and closing worksites as actions (features 005 and none); notifications and attachments (PRD, Out of scope).
- A `REJECTED` report and a reassigned task appear in this feature only as prepared test data, so that UC-2's resubmission and BR-4's check on submit can be verified before features 004 and 005 add the actions.

### Decisions carried from the implementation plan

These were settled before the Spec-Kit work (implementation plan, section 3) and are applied here, not reopened.

- Today is the calendar date in the configured time zone; rules compare calendar dates only (BR-2).
- Reported progress is limited to 0 to 100 by the stored data itself, not only by the code that writes it.
- A request key is claimed when the request arrives. A duplicate that arrives while the first is in progress is told so. The result is stored when the request completes, and the key is released if the request fails.
- The reporting part of the system reads a worksite and its tasks as a whole from the worksite part (feature 001).
- Viewing a report reads the current data. There is no separate copy kept for reading.
- `CLOSED` is set only by the example data and by tests.

### The plan's questions for clarify

The plan lists four questions. Three are settled under Clarifications: whether a save replaces the whole list of items (FR-002), notes (FR-002a), and who may view a report (FR-030). The walkthrough date (FR-037a) was also settled there, although it was not one of the plan's questions. The fourth needs no decision:

- **Closed worksite before submission**: submission is refused, stating that the worksite is closed, as BR-3 says (FR-013).

### Other assumptions

- **BR-2 applies when the report is created**, as the glossary defines the backdating limit ("how many days before today a report can be created for"). Applying it to later saves and to submission would leave a rejected report that cannot be resubmitted after a few days.
- **BR-3 applies to every save**, not only the first, as the plan's test list says ("rejects saving and submitting for a CLOSED worksite"). The rule's text names creating and submitting; a draft for a closed worksite can never be submitted, so editing it has no use.
- **A draft may be saved with no items.** BR-7 requires an item only to submit.
- **BR-6 for a save**: a Foreman's save always addresses their own report for that worksite and date, so the "only the author" part of BR-6 is reached through submission, and through future actions that address a report by its identifier.
- **Request keys do not expire** in this feature. A retention period can be added later without changing the behavior a client sees within it.
- **"The same content"** for a request key means the same action on the same report or worksite and work date, with the same body.
- **A request is checked in this order**: identity, request format and request key, permission by role, existence of the worksite or report, permission for that report, then business rules. A caller who fails an earlier check learns nothing from a later one. Because a refused viewer is told "not permitted" rather than "not found" (Clarifications), a user may learn that a report identifier exists, but nothing of its content.

### Conflicts between documents, stated for decision

- **UC-2's "Applies" line** lists BR-3 to BR-7, but not BR-11, BR-14 or BR-15. BR-11, BR-14 and BR-15 each say they apply to every transition or write, and the implementation plan applies them here. This spec applies them to submission. This is implementation plan question P4 for the product owner.
- **Who may view a report** (FR-030) is implementation plan question P2. It is settled for this feature under Clarifications. It narrows the PRD Roles row "View worksites, tasks, and reports", so the product owner should record it in `docs/product/` (for example as a use case for viewing a report).
- **The backdating limit** (FR-004, FR-037a): BR-2 in `use-cases.md` says "not more than 5 days before today", and architecture.md section 7 gives a default of 5. This spec makes the default 365 days (Clarifications). BR-2 also says the limit is configurable, so the rule's mechanism is unchanged; its number is not. `use-cases.md` must be changed by the product owner, in a separate approved edit, before this feature is merged. architecture.md is updated in this feature's commit series.
- **The walkthrough date** (FR-037): 20 November 2026 is inside the 365-day default until 20 November 2027. After that, the walkthrough needs a newer work date.

### Dependencies

- Feature 001: users and roles, the identity check, worksites with status, tasks with assignee and approved progress, the example data, the shared error shape and the ordering rule.
- The backdating limit and the time zone are configured values (glossary, Backdating limit).
- Open product questions P2 and P4 (implementation plan, section 5), and the change to BR-2's number of days. `docs/product/` changes only through the product owner.
