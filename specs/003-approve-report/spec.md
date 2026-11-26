# Feature Specification: Approve a daily report

**Feature Branch**: `003-approve-report`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "003-approve-report"

**Source**: [Implementation plan, Step 3](../../docs/engineering/implementation-plan.md#step-3-003-approve-report). Related: [Use cases](../../docs/product/use-cases.md) (UC-3, business rules), [PRD](../../docs/product/prd.md) (Report lifecycle, Roles, Example, Implementation goal 3), [Glossary](../../docs/glossary.md), [ADR 0004](../../docs/adr/0004-one-transaction-across-two-aggregates-on-approval.md), [Feature 001](../001-worksite-seed/spec.md), [Feature 002](../002-draft-and-submit/spec.md).

**Business rules implemented**: BR-5 (checked again at approval), BR-9, BR-10, BR-12 (approval), BR-15 (approval). Reused from feature 002 and applied to approval: BR-11, BR-14 (UC-3's "Applies" line lists both since `docs(product)` 93912c8). BR-3 and BR-4 apply here only through what they allow: approval is not blocked by a closed worksite or a reassigned task. BR-8, and BR-12 for rejection, belong to feature 004; BR-13 to feature 005.

## Clarifications

### Session 2026-11-26

- Q: When an approval is refused because one or more tasks already have approved progress above the report's figure, should the refusal list every such task or only the first? → A: Every such task, each with its current approved progress and its reported progress in the report.
- Q: When the worksite's Site Supervisor tries to approve a report that is still `DRAFT`, how is it refused? → A: As not permitted, as viewing a draft is in feature 002, so a Site Supervisor learns nothing about drafts from any action.
- Q: When two approvals of the same report race, should the loser always be told to reload, or may it be told "already approved" depending on timing? → A: Always reload. The version is checked before the status: any approval from an old version is refused as a conflict with the current version, and "already approved" is the answer only for an approval sent with the current version.
- Q: Can the Site Supervisor add an optional comment to an approval? → A: No. An approval carries no text, its recorded transition has no reason, and a request that includes one is refused as invalid.
- Q: Is the refusal for approving a `DRAFT` identical to the approval refusal a Foreman or another worksite's Site Supervisor gets, or to the refusal for viewing a draft? → A: Identical to the approval refusal: one code, one message and the same details for all three cases, so a draft cannot be told apart from a report the caller may not approve.
- Q: When a report is approved and one of its tasks is reported at the progress it already has, does that task count as changed and move to the top of the worksite's task list? → A: No. Only a task whose approved progress goes up is written and counts as changed; a task reported at its current value keeps its place in the list.

## User Scenarios & Testing *(mandatory)*

People are named for readability, as in the PRD example (Linda: Site Supervisor of the townhouse; Mark and Henry: Foremen; worksite "Three-storey townhouse"; tasks Pour foundation (Mark, 100%), Build ground-floor walls (Mark, 40%), Install electrical (Henry, 0%)). A second worksite, supervised by another Site Supervisor, Sam, exists where a scenario needs it. Unless a scenario says otherwise, Mark's report for 20 November holds one item, Build ground-floor walls at 55%, and is `SUBMITTED`, and Linda has read its current version.

### User Story 1 - Approve a submitted report (Priority: P1)

UC-3. Linda reviews Mark's submitted report and approves it. The report becomes `APPROVED`, the approval is recorded with who made it and when (BR-11), and the approved progress of every task in the report is set to its reported progress (BR-9). Tasks that are not in the report keep their approved progress. Before anything changes, the system checks that Linda supervises the report's worksite (BR-12), that the report is `SUBMITTED` (BR-10), and that no task in the report already has approved progress above the reported progress (BR-5).

**Why this priority**: Approval is the only way approved progress changes. Without it, reports have no effect on the official progress of a worksite, which is the purpose of the product.

**Independent Test**: As Linda, approve Mark's submitted report with its current version. Check that it is `APPROVED` with one more transition, that Build ground-floor walls now has approved progress 55%, and that Pour foundation (100%) and Install electrical (0%) are unchanged.

**Acceptance Scenarios**:

1. **Given** Mark's submitted report and its current version, **When** Linda approves it, **Then** the report is `APPROVED`, its version has increased, and a transition from `SUBMITTED` to `APPROVED` is recorded, by Linda, at the time of approval with its time zone, and no reason (BR-11).
2. **Given** Linda has approved Mark's report, **When** anyone views the townhouse, **Then** Build ground-floor walls has approved progress 55%, Install electrical still 0%, and Pour foundation still 100% (BR-9; PRD example, row "Linda approves Mark's report").
3. **Given** a submitted report with two items, Build ground-floor walls at 55% and Pour foundation at 100%, **When** Linda approves it, **Then** both tasks have approved progress equal to their reported progress.
4. **Given** a submitted report whose reported progress for a task equals that task's approved progress (Build ground-floor walls at 40%), **When** Linda approves it, **Then** it is accepted, the task stays at 40%, and it keeps its place in the worksite's task list (BR-5: greater than or equal; Clarifications).
5. **Given** Mark's report was submitted and the townhouse was then closed, **When** Linda approves it, **Then** it is accepted and approved progress is updated (BR-3: a report already `SUBMITTED` when the worksite was closed can still be approved).
6. **Given** Mark's report includes Build ground-floor walls and that task was reassigned to Henry after submission, **When** Linda approves it, **Then** it is accepted, Build ground-floor walls gets 55%, and its assignee stays Henry (BR-4: assignment is not checked at approval).
7. **Given** Linda has approved Mark's report, **When** Mark or Linda views it, **Then** they see it in `APPROVED`, with its new version and both transitions, oldest first.

---

### User Story 2 - Approval is all or nothing (Priority: P1)

PRD implementation goal 3, and UC-3's first acceptance criterion. Approved progress never goes down (PRD, Out of scope: "Lowering a task's approved progress"). Because reports can be approved out of date order, a task's approved progress may have risen above a report's figure between submission and approval. When that happens for any task in the report, the approval is refused (BR-5), and nothing changes: the report stays `SUBMITTED` and no task changes, not even the tasks whose figures were fine (BR-9). Linda's way forward is to reject the report (feature 004).

**Why this priority**: An approval that updates some tasks and not others leaves the worksite's official progress in a state no one decided. This is one of the PRD's three implementation goals.

**Independent Test**: Submit Mark's reports for 19 November (Build ground-floor walls at 40%) and 20 November (60%). Approve the 20th, then try to approve the 19th. Check that the second approval is refused, naming Build ground-floor walls and its approved progress, 60%, that the report for the 19th is still `SUBMITTED` with its version unchanged and no new transition, and that the task is still 60%. Then, with a prepared submitted report holding one valid item and one stale item, check that approving it changes neither task.

**Acceptance Scenarios**:

1. **Given** Mark's reports for 19 November (Build ground-floor walls at 40%) and 20 November (60%) are both `SUBMITTED`, **When** Linda approves the 20th and then the 19th, **Then** the second approval is refused, naming Build ground-floor walls and its current approved progress, 60%, and the task stays at 60% (BR-5; use-cases.md, the example after BR-5).
2. **Given** the same two reports, **When** Linda approves the 19th first and then the 20th, **Then** both are accepted and Build ground-floor walls ends at 60%.
3. **Given** a submitted report with two items, one of which is below its task's current approved progress, **When** Linda approves it, **Then** the approval is refused, the report stays `SUBMITTED` with the same version and history, and neither task changes, including the one whose figure was valid (BR-9; UC-3 acceptance: "0 tasks changed. Report still `SUBMITTED`").
4. **Given** a submitted report with several items below their tasks' current approved progress, **When** Linda approves it, **Then** the refusal names every such task with its current approved progress and its reported progress (Clarifications).
5. **Given** an approval that fails for any reason after it has started changing data, **When** the failure happens, **Then** every change it made is undone: the report stays `SUBMITTED` and no task changes (BR-9).

---

### User Story 3 - Only the worksite's Site Supervisor approves, and only once (Priority: P1)

UC-3's third acceptance criterion and BR-10, BR-12. A Foreman never approves a report, and a Site Supervisor approves only reports of the worksites they supervise. An approved report is final: nobody can approve it again, edit it or submit it.

**Why this priority**: The PRD's separation of roles ("the person who approves a report is never the person who wrote it") and the finality of approval are what make approved progress trustworthy.

**Independent Test**: Try to approve Mark's submitted report as Mark, as Henry, and as Sam, and check each is refused as not permitted and nothing changes. Then approve it as Linda, and check that approving it again, saving to it, and submitting it are each refused, stating that it is `APPROVED`.

**Acceptance Scenarios**:

1. **Given** Mark's submitted report, **When** Mark, its author, approves it, **Then** the request is refused as not permitted and the report stays `SUBMITTED` (BR-12; UC-3 acceptance).
2. **Given** Mark's submitted report, **When** Henry, another Foreman, approves it, **Then** the request is refused as not permitted (BR-12).
3. **Given** Mark's submitted report on the townhouse, **When** Sam, the Site Supervisor of another worksite, approves it, **Then** the request is refused as not permitted (BR-12; UC-3 acceptance).
4. **Given** Mark's report is `APPROVED`, **When** Linda approves it again with its current version, **Then** it is refused, stating the current status, `APPROVED`, and nothing changes (BR-10).
5. **Given** Mark's report is `APPROVED`, **When** Mark saves changes to it or submits it, **Then** each is refused, stating the current status, `APPROVED` (BR-10; feature 002 already refuses these, and this feature adds the real path to `APPROVED`).
6. **Given** Mark's report is `DRAFT`, **When** Linda approves it, **Then** the request is refused as not permitted, with exactly the answer Sam gets in scenario 3 (Clarifications), and nothing changes.
7. **Given** Mark's report is `REJECTED` (set up directly; rejecting is added in feature 004), **When** Linda approves it, **Then** it is refused, stating the current status, `REJECTED` (Report lifecycle).
8. **Given** a report identifier that does not exist, **When** Linda approves it, **Then** the request is refused as not found.

---

### User Story 4 - Retries and simultaneous decisions (Priority: P1)

UC-3's second acceptance criterion, BR-14 and BR-15. Linda may retry an approval on a weak connection, or approve from two devices at once. A retry with the same request key returns the original result and approves once. Of two approvals started together on the same report, exactly one wins; the other is refused as a conflict and changes nothing.

**Why this priority**: Without these, a retry or a double click could record the approval twice, and two decisions made from stale copies could both appear to succeed.

**Independent Test**: Start two approvals of Mark's submitted report at the same moment, both from its current version. Check that exactly one succeeds, the other is refused as a conflict, exactly one approval transition is recorded, and Build ground-floor walls is 55%. Then repeat the successful request with its request key, and check that the original response is returned and nothing else changes.

**Acceptance Scenarios**:

1. **Given** Mark's submitted report at version 3, **When** two approvals from version 3 start at the same moment, **Then** exactly one succeeds; the other is always refused as a conflict that gives the current version, never as "already approved", and exactly one approval transition is recorded (BR-15; UC-3 acceptance, approve against approve; Clarifications).
2. **Given** Mark's report has changed since Linda last read it, **When** Linda approves it with the older version, **Then** it is refused as a conflict that gives the current version and asks Linda to reload, and nothing changes (BR-15).
3. **Given** Linda's approval has succeeded, **When** Linda repeats it with the same request key, **Then** the original response is returned, the report has one approval transition, and no task changes again (BR-14).
4. **Given** a request key Linda has already used, **When** Linda sends a different request with that key (another report, or another version), **Then** it is refused, stating that the key has already been used, and nothing changes (BR-14).
5. **Given** an approval without a request key, or without a version, **When** it is sent, **Then** it is refused as an invalid request, stating what is missing.
6. **Given** an approval that was refused, for example by BR-5, **When** Linda sends it again with the same request key, **Then** it is processed afresh (feature 002, FR-026).
7. **Given** two different submitted reports that both include Build ground-floor walls, at 50% and 60%, **When** Linda approves both at the same moment, **Then** the task's approved progress never goes below a value already approved: either both succeed and the task ends at 60%, or the 60% approval succeeds first and the 50% approval is refused by BR-5. In neither case is the task left at 50% after 60% was approved.

---

### User Story 5 - Walk through the approval by hand (Priority: P2)

Continuing feature 002's walkthrough: after Mark drafts and submits his report for 20 November, a person approves it as Linda and sees the PRD example's row "Linda approves Mark's report".

**Why this priority**: The automated tests prove the rules. The walkthrough lets a person see the example from the PRD work in a running system.

**Independent Test**: Start the system, follow the walkthrough through Mark's submission and Linda's approval, then view the townhouse.

**Acceptance Scenarios**:

1. **Given** a freshly started system and the walkthrough, **When** a person runs Mark's draft, edit and submission and then Linda's approval, **Then** Mark's report is `APPROVED`, Build ground-floor walls shows 55%, and Install electrical shows 0%.

---

### Edge Cases

- **Approving with an equal figure**: reported progress equal to approved progress is accepted; the task keeps its value and is not counted as changed (BR-5: greater than or equal; Clarifications).
- **Task at 100%**: a report that reports a task at 100% can be approved; the task is complete when its approved progress is 100% (PRD, Model).
- **Task reassigned after submission**: approval proceeds; it changes the task's approved progress, not its assignee (BR-4, BR-13).
- **Worksite closed after submission**: approval proceeds (BR-3).
- **Approval reason**: an approval carries no reason, and its recorded transition has none. A request that includes a reason or comment is refused as an invalid request (Clarifications).
- **Report changed between read and approval**: only the version stated in the request counts. A report that is still `SUBMITTED` but whose version has moved on is refused as a conflict (BR-15). In this feature only an approval can change a `SUBMITTED` report; from feature 004 a rejection can too.
- **Approval refused by BR-5**: the report stays `SUBMITTED` and can only be rejected (feature 004). It cannot be approved later unless approved progress goes down, which the PRD rules out.
- **Supervisor with no worksites, or supervising only other worksites**: refused as not permitted, as Sam is.
- **Request key reused across actions**: a key Linda used for one approval and then sends with an approval of another report is "already used" (BR-14). Keys of different users never collide (feature 002, FR-025).
- **Version that is not a whole number**: refused as an invalid request.
- **Approval transitions are permanent**: like every transition, an approval transition can never be changed or removed (feature 002, FR-020).
- **Approved progress of tasks not in the report**: unchanged, whatever their value (PRD example: Install electrical stays 0%).

## Requirements *(mandatory)*

### Functional Requirements

**Approving (UC-3)**

- **FR-001**: The Site Supervisor of a report's worksite MUST be able to approve a report that is `SUBMITTED`. Approval MUST move it to `APPROVED`.
- **FR-002**: Approval MUST set the approved progress of every task in the report to that task's reported progress in the report (BR-9). It MUST NOT change any task that is not in the report, and MUST NOT change any task's assignee, name or worksite. A task whose reported progress equals its approved progress MUST NOT be written, so it does not count as changed in the worksite's task list (feature 001's order, last changed first) (Clarifications).
- **FR-003**: Approval MUST record a transition from `SUBMITTED` to `APPROVED`, with the approving Site Supervisor as actor, the time as a timestamp with its time zone, and no reason (BR-11).
- **FR-004**: Approval MUST increase the report's version, and its response MUST return the report as feature 002 FR-031 describes it, with the new version, status and transition.
- **FR-005**: Approval MUST NOT change the report's items, notes, author, worksite or work date.

**Checks at approval**

- **FR-006**: Approval MUST be refused when any task in the report has a current approved progress above its reported progress in the report. The refusal MUST name every such task with its current approved progress and its reported progress (BR-5).
- **FR-007**: The BR-5 check MUST hold at the moment the change is applied, not only when the request arrives: if another approval raises a task's approved progress above this report's figure in the meantime, this approval MUST be refused (BR-5, BR-9).
- **FR-008**: Approval MUST NOT check whether the worksite is `ACTIVE` (BR-3) or whether each task is still assigned to the author (BR-4).
- **FR-009**: Approval MUST be refused, stating the current status, when the report is `APPROVED` or `REJECTED` (BR-10; Report lifecycle). Approval of a `DRAFT` MUST be refused as not permitted, with exactly the refusal of FR-012 (same code, message and details), so a draft cannot be told apart from a report the caller may not approve (Clarifications).

**All or nothing (BR-9)**

- **FR-010**: An approval MUST apply all of its changes together: the report's status and version, the transition, and every task's approved progress. If any part cannot be applied, none of it MUST be applied, and the report MUST stay `SUBMITTED` with its previous version and history.
- **FR-011**: A task's approved progress MUST never decrease as the result of an approval, including when two approvals that include the same task run at the same time.

**Permissions (BR-12)**

- **FR-012**: Only the Site Supervisor of the report's worksite MUST be able to approve it. A Foreman, including the report's author, and the Site Supervisor of another worksite, MUST be refused as not permitted, and nothing MUST change.
- **FR-013**: A report identifier that does not exist MUST be refused as not found.

**Finality (BR-10)**

- **FR-014**: An `APPROVED` report MUST NOT be edited, submitted or approved again. Each attempt MUST be refused, stating the current status, `APPROVED`.

**Safe retries and no silent overwrites (BR-14, BR-15)**

- **FR-015**: Every approval MUST carry a request key and the version of the report the caller last read, and nothing else. A request missing either, or carrying any other content such as a reason or comment, MUST be refused as an invalid request (Clarifications).
- **FR-016**: Repeating an approval with the same key and the same content, by the same user, MUST return the original result and MUST NOT record a second transition or change any task again. The request-key behavior of feature 002 (FR-021 to FR-026) MUST apply to approval unchanged.
- **FR-017**: An approval whose version is not the report's current version MUST be refused as a conflict that gives the current version and asks the caller to reload, and MUST change nothing.
- **FR-018**: Of two approvals of the same report started from the same version, exactly one MUST succeed; the other MUST be refused as a conflict.

**Errors and order of checks**

- **FR-019**: Every refusal MUST use the shared error shape from feature 001: a stable code, a message that says what went wrong, and optional details such as the offending tasks, the current status or the current version.
- **FR-020**: An approval MUST be checked in this order: identity, request format, request key and version presence, existence of the report, permission for the report (BR-12, and a `DRAFT` is treated as not permitted), then version (BR-15), status (BR-10) and progress (BR-5). An approval from an old version is therefore always refused as a conflict, whatever the report's status now is (Clarifications). A caller who fails an earlier check learns nothing from a later one.

**Walkthrough**

- **FR-021**: The manual walkthrough MUST continue feature 002's: after Mark submits his report for 20 November, Linda approves it, and viewing the townhouse then shows Build ground-floor walls at 55% and Install electrical at 0%.

### Key Entities

- **Daily Report** (feature 002): gains its first path to `APPROVED`. Status, version and history change on approval; items do not.
- **Transition** (feature 002): an approval adds one, from `SUBMITTED` to `APPROVED`, with the Site Supervisor as actor and no reason.
- **Task** (feature 001): its approved progress is set from the report on approval. Its assignee, name and worksite are not changed.
- **Worksite** (feature 001): read here for its Site Supervisor (BR-12). Its status is not checked at approval (BR-3).
- **Request key record** (feature 002): used unchanged for approvals.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Approving the PRD example report changes exactly 1 task's approved progress (Build ground-floor walls, 40% to 55%), and 0 other tasks.
- **SC-002**: An approval refused by BR-5, or failing partway, leaves 0 tasks changed, the report `SUBMITTED`, and 0 new transitions (UC-3 acceptance).
- **SC-003**: Of 2 approvals of the same report started at the same moment, exactly 1 succeeds and 1 is refused as a conflict, and exactly 1 approval transition exists afterwards (UC-3 acceptance).
- **SC-004**: 100% of approval attempts by a Foreman or by the Site Supervisor of another worksite are refused as not permitted, and 0 of them change any data (UC-3 acceptance).
- **SC-005**: 5 identical approval requests with the same request key yield 1 approval transition, 1 change to each task, and 5 identical responses.
- **SC-006**: After any sequence of approvals, in any order and at any concurrency, no task's approved progress is lower than a value it held before.
- **SC-007**: 100% of approvals refused by BR-5 name every offending task and its current approved progress, so the Site Supervisor can state the reason when rejecting the report.
- **SC-008**: A person new to the project can reproduce the PRD row "Linda approves Mark's report" by following only the setup instructions and the manual walkthrough.

## Assumptions

### Scope boundaries

- In scope: UC-3 Approve a report, with BR-5 at approval, BR-9, BR-10, BR-12 and BR-15, and BR-11 and BR-14 applied to approval as in feature 002.
- Out of scope: rejecting a report (feature 004, including BR-8 and the approve-against-reject race); creating worksites, adding and reassigning tasks (feature 005); closing a worksite as an action (no feature); lowering approved progress (PRD, Out of scope); listing reports awaiting approval; notifications.
- A `REJECTED` report, a reassigned task and a closed worksite appear in this feature only as prepared test data, as in feature 002.

### Decisions carried from the implementation plan

These were settled before the Spec-Kit work (implementation plan, section 3) and are applied here, not reopened.

- The report's change and every task's change are applied together or not at all (ADR 0004).
- The reporting part of the system reads the worksite, its Site Supervisor and its tasks as a whole from the worksite part (feature 001).

### The plan's questions for clarify

The plan lists two questions for `/speckit-clarify`:

- **When approval fails because of BR-5, name every task or the first?** Settled under Clarifications: every task, with its current approved progress and reported progress (FR-006). The Site Supervisor cannot fix the report and must reject it, so the full list is what the rejection reason needs. This differs from submission in feature 002, which names the first offending task.
- **Can a report be approved after one of its tasks was reassigned?** Yes. BR-4 in use-cases.md says so explicitly ("a `SUBMITTED` report can still be approved or rejected after one of its tasks is reassigned"), so it needs no decision (US1-6, FR-008).

### Other assumptions

- **An approval carries no reason or comment** (Clarifications). BR-11 records a reason "if one was given", and only BR-8 (rejection) requires one. An optional comment can be added later without breaking existing clients.
- **Approving a `REJECTED` or `APPROVED` report** states the status, because the Site Supervisor can already view it. A `DRAFT` is refused as not permitted instead (Clarifications).
- **BR-12 is checked before status.** A Foreman or another Site Supervisor is refused as not permitted whatever the report's status, so they learn nothing about it.
- **The version is checked before the status** (Clarifications), so the loser of a race always gets the same answer. Approving an `APPROVED` report from its current version, after a reload, says "already approved" (US3-4).

### Conflicts between documents, stated for decision

- **UC-3's second acceptance criterion** verifies "Approve and reject concurrently", but rejection arrives in feature 004. This feature verifies the same guarantee with two concurrent approvals (US4-1), as the implementation plan's Step 3 tests do. The approve-against-reject case is tested in feature 004.

### Dependencies

- Feature 001: users and roles, worksites with their Site Supervisor and status, tasks with assignee and approved progress, the example data, the shared error shape.
- Feature 002: submitted reports, versions, transitions, request keys, the report view, and the walkthrough this feature continues.
- `docs/product/` as of 93912c8: UC-3 applies BR-11 and BR-14 (open question P4, answered); UC-5 and the PRD Roles table say who may view a report, which FR-009's draft refusal relies on.
