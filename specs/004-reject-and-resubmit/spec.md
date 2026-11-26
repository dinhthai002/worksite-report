# Feature Specification: Reject and resubmit a daily report

**Feature Branch**: `004-reject-and-resubmit`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "004-reject-and-resubmit"

**Source**: [Implementation plan, Step 4](../../docs/engineering/implementation-plan.md#step-4-004-reject-and-resubmit). Related: [Use cases](../../docs/product/use-cases.md) (UC-2, UC-3, UC-4, UC-5, business rules), [PRD](../../docs/product/prd.md) (Report lifecycle, Roles, Example, Implementation goals), [Glossary](../../docs/glossary.md), [Feature 001](../001-worksite-seed/spec.md), [Feature 002](../002-draft-and-submit/spec.md), [Feature 003](../003-approve-report/spec.md).

**Business rules implemented**: BR-8, BR-12 (rejection), BR-15 (rejection, and approval against rejection). Reused and applied to rejection: BR-10, BR-11, BR-14. Reused unchanged for editing and resubmitting a rejected report, now reachable for real: BR-3, BR-4, BR-5, BR-6, BR-7 (feature 002). BR-3 and BR-4 apply to rejection only through what they allow: rejection is not blocked by a closed worksite or a reassigned task. BR-13 belongs to feature 005.

## Clarifications

### Session 2026-11-26

- Q: What is the longest rejection reason a Site Supervisor may write? → A: 2,000 characters of plain text, the same limit as the report note and item notes in feature 002.
- Q: When a rejection arrives with the reason missing altogether, is it refused as an invalid request or with the same refusal as an empty or blank reason? → A: The same refusal: missing, empty and blank all get "a reason is required" (BR-8), checked after permission, version and status.
- Q: A report rejected after its worksite is closed can be neither edited nor resubmitted. Is that accepted as the rules stand, and raised with the product owner? → A: Accepted as written in this feature: the report stays `REJECTED`. The gap is raised for the product owner as open product question P6 in the implementation plan, section 5.
- Q: When a reason has spaces or blank lines at the start or end, is it kept exactly as typed or trimmed before saving? → A: Kept exactly as sent, as notes are in feature 002. The 2,000-character limit counts every character.

## User Scenarios & Testing *(mandatory)*

People are named for readability, as in the PRD example (Linda: Site Supervisor of the townhouse; Mark and Henry: Foremen; worksite "Three-storey townhouse"; tasks Pour foundation (Mark, 100%), Build ground-floor walls (Mark, 40%), Install electrical (Henry, 0%)). A second worksite, supervised by another Site Supervisor, Sam, exists where a scenario needs it. Unless a scenario says otherwise, Henry's report for 20 November holds one item, Install electrical at 10%, and is `SUBMITTED`, and Linda has read its current version.

### User Story 1 - Reject a submitted report with a reason (Priority: P1)

UC-4, first half. Linda reviews Henry's submitted report and does not accept it. She rejects it and says why: "conduit laid, no wiring pulled yet". The report becomes `REJECTED`, the rejection is recorded with who made it, when, and the reason (BR-8, BR-11), and no task's approved progress changes.

**Why this priority**: Without rejection, a report the Site Supervisor cannot accept has no way forward: it can be neither approved (feature 003 refuses some of them by BR-5) nor withdrawn (PRD, Out of scope). Rejection is the only path that reopens a report.

**Independent Test**: As Linda, reject Henry's submitted report with its current version and the PRD's reason. Check that it is `REJECTED` with one more transition carrying that reason, and that Install electrical still has approved progress 0%.

**Acceptance Scenarios**:

1. **Given** Henry's submitted report and its current version, **When** Linda rejects it with the reason "conduit laid, no wiring pulled yet", **Then** the report is `REJECTED`, its version has increased, and a transition from `SUBMITTED` to `REJECTED` is recorded, by Linda, at the time of rejection with its time zone, with that reason (BR-8, BR-11).
2. **Given** Linda has rejected Henry's report, **When** anyone views the townhouse, **Then** Install electrical still has approved progress 0%, and no other task has changed (UC-4 acceptance; PRD example, row "Linda rejects Henry's report").
3. **Given** Henry's submitted report, **When** Linda rejects it with no reason, an empty reason, or a reason of only spaces, **Then** it is refused, stating that a reason is required, and nothing changes (BR-8).
4. **Given** Henry's report was submitted and the townhouse was then closed, **When** Linda rejects it, **Then** it is accepted (BR-3: a report already `SUBMITTED` when the worksite was closed can still be rejected).
5. **Given** Henry's report includes Install electrical and that task was reassigned to Mark after submission, **When** Linda rejects it, **Then** it is accepted (BR-4: assignment is not checked at rejection).
6. **Given** a report whose approval was refused by BR-5 (feature 003, US2-1: Mark's report for 19 November at 40% after the 20th was approved at 60%), **When** Linda rejects it with a reason, **Then** it is accepted. This is the way forward feature 003 points to.
7. **Given** Linda has rejected Henry's report, **When** Henry or Linda views it, **Then** they see it in `REJECTED`, with its new version and both transitions, oldest first, the rejection showing Linda's reason.

---

### User Story 2 - The Foreman sees the reason, edits and resubmits (Priority: P1)

UC-4, second half. Henry views his rejected report and reads Linda's reason. He edits the report while it is still `REJECTED`, changing Install electrical to 5%, and submits it again. The report returns to `SUBMITTED`, and the rejection and its reason stay in the history (PRD, Report lifecycle). Approved progress does not change at any point until Linda approves.

**Why this priority**: Rejection is only useful if the Foreman can act on it. Keeping the report, its history and its reason, rather than starting over, is what the PRD's lifecycle requires.

**Independent Test**: Reject Henry's report as Linda. As Henry, view it and read the reason; save Install electrical at 5%; submit. Check the report is `SUBMITTED` with three transitions, the rejection still carrying its reason, and that Install electrical's approved progress is 0% after every step.

**Acceptance Scenarios**:

1. **Given** Henry's report is `REJECTED`, **When** Henry views it, **Then** he sees the rejection transition with Linda as actor, its time, and the reason "conduit laid, no wiring pulled yet".
2. **Given** Henry's report is `REJECTED`, **When** Henry saves it with Install electrical at 5% and its current version, **Then** the save is kept, the report stays `REJECTED`, its version increases, and the response shows the report with its history, including the rejection reason (BR-6).
3. **Given** Henry has edited his rejected report, **When** Henry submits it with its current version, **Then** the report is `SUBMITTED`, a transition from `REJECTED` to `SUBMITTED` is recorded by Henry, and the earlier transitions, including the rejection and its reason, are unchanged (BR-11; PRD, Report lifecycle).
4. **Given** Henry's report is `REJECTED`, **When** Henry submits it again without editing, **Then** it is accepted, as long as the submission checks of feature 002 pass. Editing before resubmitting is not required.
5. **Given** Henry's report is `REJECTED`, **When** Mark, or Linda, saves changes to it or submits it, **Then** each is refused as not permitted and nothing changes (BR-6; PRD, Roles).
6. **Given** each step of reject, edit, resubmit, **When** the townhouse's tasks are checked after each step, **Then** no task's approved progress has changed (UC-4 acceptance: "0 tasks changed until the final approval").
7. **Given** Henry has resubmitted his report, **When** Linda approves it, **Then** it is `APPROVED`, Install electrical has approved progress 5%, and the report's history has four transitions in order: submitted, rejected (with reason), submitted, approved (UC-4 acceptance; PRD example, last row).
8. **Given** Henry has resubmitted his report, **When** Linda rejects it a second time with another reason, **Then** it is accepted, and both rejections and their reasons are in the history. A report can go round the reject-and-resubmit cycle any number of times.

---

### User Story 3 - Only the worksite's Site Supervisor rejects, and only a submitted report (Priority: P1)

BR-10, BR-12 and the Report lifecycle. A Foreman never rejects a report, and a Site Supervisor rejects only reports of the worksites they supervise. Only a `SUBMITTED` report can be rejected; an `APPROVED` report is final.

**Why this priority**: The PRD's separation of roles applies to rejection as to approval. A rejection of an approved report would reopen a decision that has already changed approved progress.

**Independent Test**: Try to reject Henry's submitted report as Henry, as Mark, and as Sam, and check each is refused as not permitted and nothing changes. Then try to reject an `APPROVED`, a `REJECTED` and a `DRAFT` report as Linda, and check each is refused as this story describes.

**Acceptance Scenarios**:

1. **Given** Henry's submitted report, **When** Henry, its author, rejects it, **Then** the request is refused as not permitted and the report stays `SUBMITTED` (BR-12).
2. **Given** Henry's submitted report, **When** Mark, another Foreman, rejects it, **Then** the request is refused as not permitted (BR-12).
3. **Given** Henry's submitted report on the townhouse, **When** Sam, the Site Supervisor of another worksite, rejects it, **Then** the request is refused as not permitted (BR-12).
4. **Given** Mark's report is `APPROVED`, **When** Linda rejects it with its current version and a reason, **Then** it is refused, stating the current status, `APPROVED`, and nothing changes (BR-10).
5. **Given** Henry's report is `REJECTED`, **When** Linda rejects it again with its current version, **Then** it is refused, stating the current status, `REJECTED` (Report lifecycle).
6. **Given** Henry's report is `DRAFT`, **When** Linda rejects it, **Then** the request is refused as not permitted, with exactly the answer Sam gets in scenario 3, and nothing changes, as for approving a draft in feature 003.
7. **Given** a report identifier that does not exist, **When** Linda rejects it, **Then** the request is refused as not found.
8. **Given** Henry's submitted report, **When** Henry, Mark, or Sam rejects it without a reason, **Then** they are refused as not permitted, not told that a reason is required: a caller who may not reject learns nothing from the later checks.

---

### User Story 4 - Simultaneous decisions and retries (Priority: P1)

UC-3's second acceptance criterion ("Approve and reject concurrently"), deferred from feature 003, and BR-14, BR-15 for rejection. Linda may approve on one device and reject on another, or retry a rejection on a weak connection. Of an approval and a rejection started together on the same report, exactly one wins, and the other changes nothing. A retry with the same request key returns the original result and rejects once.

**Why this priority**: If both decisions could succeed, the report could end `REJECTED` with approved progress already raised, which contradicts BR-9 and UC-4. This is PRD implementation goal 2 applied to the two decisions.

**Independent Test**: Start an approval and a rejection of Henry's submitted report at the same moment, both from its current version. Check that exactly one succeeds and the other is refused as a conflict, that exactly one new transition is recorded, and that Install electrical's approved progress matches the winner (10% if the approval won, 0% if the rejection won).

**Acceptance Scenarios**:

1. **Given** Henry's submitted report at version 3, **When** an approval and a rejection from version 3 start at the same moment, **Then** exactly one succeeds; the other is always refused as a conflict that gives the current version, and exactly one new transition is recorded (BR-15; UC-3 acceptance).
2. **Given** the race in scenario 1 is won by the rejection, **When** the tasks are checked, **Then** no task's approved progress has changed. **Given** it is won by the approval, **Then** Install electrical has approved progress 10% and the report is `APPROVED`.
3. **Given** two rejections of Henry's report from the same version start at the same moment, **When** they complete, **Then** exactly one succeeds and the other is refused as a conflict, and one rejection transition is recorded.
4. **Given** Henry's report has changed since Linda last read it, **When** Linda rejects it with the older version, **Then** it is refused as a conflict that gives the current version and asks Linda to reload, and nothing changes (BR-15).
5. **Given** Linda has rejected Henry's report and Henry has since edited it, **When** Henry submits it with the version he read before his own edit, **Then** it is refused as a conflict (BR-15, as in feature 002).
6. **Given** Linda's rejection has succeeded, **When** Linda repeats it with the same request key and content, **Then** the original response is returned and the report has one rejection transition (BR-14).
7. **Given** a request key Linda has already used, **When** Linda sends a different request with that key (another report, another version or another reason), **Then** it is refused, stating that the key has already been used, and nothing changes (BR-14).
8. **Given** a rejection without a request key or without a version, **When** it is sent, **Then** it is refused as an invalid request, stating what is missing.

---

### User Story 5 - The whole PRD example runs end to end (Priority: P1)

The PRD's three-storey townhouse example, row by row, as one automated check: Mark and Henry submit; Linda approves Mark's report; Linda rejects Henry's report with the reason "conduit laid, no wiring pulled yet"; Henry changes the figure to 5% and resubmits; Linda approves. With this feature, every use case UC-1 to UC-5 and every PRD implementation goal is exercised in one flow.

**Why this priority**: This is the product's reference scenario, and the implementation plan's exit criterion for the last step of the report lifecycle. It shows the parts work together, not only one at a time.

**Independent Test**: From the example data, run the PRD example's steps in order and, after each, compare both tasks' approved progress with the PRD table.

**Acceptance Scenarios**:

1. **Given** the example data, **When** Mark submits Build ground-floor walls at 55% and Henry submits Install electrical at 10%, **Then** Build ground-floor walls is 40% and Install electrical 0% (PRD row "Both reports submitted, none approved").
2. **When** Linda approves Mark's report, **Then** 55% and 0% (PRD row "Linda approves Mark's report").
3. **When** Linda rejects Henry's report with the reason "conduit laid, no wiring pulled yet", **Then** 55% and 0% (PRD row "Linda rejects Henry's report").
4. **When** Henry changes the figure to 5%, resubmits, and Linda approves, **Then** 55% and 5% (PRD last row).
5. **Given** the end state of scenario 4, **When** Mark tries to report Build ground-floor walls below 55%, or to report Install electrical, for 21 November, **Then** each is refused (PRD example, last paragraph: BR-5 on submission, BR-4).

---

### User Story 6 - Walk through the whole example by hand (Priority: P2)

The manual walkthrough, extended from features 002 and 003, covers the whole PRD example, so a person can see the full lifecycle in a running system. The setup instructions describe what the walkthrough does.

**Why this priority**: The automated tests prove the rules. The walkthrough lets a person see the whole example work.

**Independent Test**: Start the system from a clean state, follow the setup instructions and run the walkthrough from the first step to the last, checking the townhouse's task progress where the walkthrough says to.

**Acceptance Scenarios**:

1. **Given** a freshly started system, **When** a person runs the walkthrough from start to end, **Then** each step succeeds, and the task progress the walkthrough shows matches every row of the PRD example table.
2. **Given** the setup instructions, **When** a person reads what they say the walkthrough does, **Then** it matches the steps the walkthrough performs.

---

### Edge Cases

- **Blank reason**: a reason of only spaces, tabs or line breaks counts as no reason (BR-8).
- **Long reason**: a reason longer than 2,000 characters, the limit for notes in feature 002, is refused as an invalid request, stating the limit (Clarifications). A reason of exactly 2,000 characters is accepted.
- **Reason text**: plain text, stored and shown exactly as sent, including any leading or trailing whitespace, which also counts toward the limit (Clarifications).
- **Rejected report on a worksite closed later**: the report can be rejected (BR-3), but the Foreman can then neither save nor resubmit it, because both need an `ACTIVE` worksite (BR-3; feature 002, FR-005, FR-013). The report stays `REJECTED`. This follows from the rules as written and is built as such; whether it should change is open product question P6 (Clarifications).
- **Task reassigned while the report is rejected**: saving or resubmitting the report with that task is refused, naming the task (BR-4). Henry can save the report without that task and then resubmit.
- **Approved progress raised while the report is rejected**: resubmitting with a figure below the task's current approved progress is refused, naming the task and its approved progress (BR-5). Henry raises the figure and resubmits.
- **Save that removes every item from a rejected report**: the save is kept, and resubmitting is refused until an item is added (BR-7).
- **Reject, then approve without resubmitting**: refused, stating the current status, `REJECTED` (feature 003, FR-009).
- **Viewing**: Linda can view a `REJECTED` report, since she can view every status except `DRAFT` (UC-5). Mark cannot view Henry's report in any status.
- **Rejection transitions are permanent**: like every transition, a rejection and its reason can never be changed or removed (feature 002, FR-020).
- **Request key reused across actions**: a key Linda used for an approval and then sends with a rejection is "already used" (BR-14).
- **Version that is not a whole number**: refused as an invalid request.

## Requirements *(mandatory)*

### Functional Requirements

**Rejecting (UC-4)**

- **FR-001**: The Site Supervisor of a report's worksite MUST be able to reject a report that is `SUBMITTED`. Rejection MUST move it to `REJECTED`.
- **FR-002**: A rejection MUST carry a reason. A missing, empty or blank reason (only whitespace) MUST be refused with one and the same refusal, stating that a reason is required, and MUST change nothing (BR-8). A missing reason MUST NOT be refused as an invalid request (Clarifications).
- **FR-003**: The reason MUST be plain text of at most 2,000 characters, the limit for notes in feature 002 (Clarifications). A longer reason MUST be refused as an invalid request, stating the limit. The reason MUST be stored and shown exactly as sent, without trimming, and the limit MUST count every character (Clarifications).
- **FR-004**: Rejection MUST record a transition from `SUBMITTED` to `REJECTED`, with the rejecting Site Supervisor as actor, the time as a timestamp with its time zone, and the reason (BR-11).
- **FR-005**: Rejection MUST increase the report's version, and its response MUST return the report as feature 002 FR-031 describes it, with the new version, status and transition.
- **FR-006**: Rejection MUST NOT change any task, and MUST NOT change the report's items, notes, author, worksite or work date.
- **FR-007**: Rejection MUST NOT check whether the worksite is `ACTIVE` (BR-3), whether each task is still assigned to the author (BR-4), or how reported progress compares with approved progress (BR-5).
- **FR-008**: Rejection MUST be refused, stating the current status, when the report is `APPROVED` (BR-10) or `REJECTED` (Report lifecycle). Rejection of a `DRAFT` MUST be refused as not permitted, with exactly the refusal of FR-009 (same code, message and details), as approval of a draft is in feature 003.

**Permissions (BR-12)**

- **FR-009**: Only the Site Supervisor of the report's worksite MUST be able to reject it. A Foreman, including the report's author, and the Site Supervisor of another worksite, MUST be refused as not permitted, and nothing MUST change.
- **FR-010**: A report identifier that does not exist MUST be refused as not found.

**Seeing the reason, editing and resubmitting**

- **FR-011**: The author and the worksite's Site Supervisor MUST be able to see every rejection's reason, actor and time in the report's history, wherever the report is returned: when viewing it, and in the responses to a save, a submission, an approval and a rejection (feature 002, FR-031, FR-034).
- **FR-012**: The author MUST be able to save a `REJECTED` report, with every check of feature 002 for saving (BR-3, BR-4, BR-5 range, BR-6, BR-15). Saving MUST leave the report `REJECTED`.
- **FR-013**: The author MUST be able to submit a `REJECTED` report, edited or not, with every check of feature 002 for submitting (BR-3, BR-4, BR-5, BR-7, BR-15). Submitting MUST move it to `SUBMITTED` and record a transition from `REJECTED` to `SUBMITTED`.
- **FR-014**: Editing and resubmitting MUST NOT change or remove any earlier transition. A report MUST be able to be rejected and resubmitted any number of times, each rejection keeping its own reason.
- **FR-015**: No step of the reject, edit and resubmit flow MUST change any task's approved progress. Only an approval changes it (UC-4 acceptance; feature 003).

**Safe retries and no silent overwrites (BR-14, BR-15)**

- **FR-016**: Every rejection MUST carry a request key, the version of the report the caller last read, and the reason, and nothing else. A request missing the key or the version, or carrying any other content, MUST be refused as an invalid request. A missing reason is refused by FR-002, not here.
- **FR-017**: The request-key behavior of feature 002 (FR-021 to FR-026) MUST apply to rejection unchanged. Repeating a rejection with the same key and the same content, by the same user, MUST return the original result and MUST NOT record a second transition.
- **FR-018**: A rejection whose version is not the report's current version MUST be refused as a conflict that gives the current version and asks the caller to reload, and MUST change nothing.
- **FR-019**: Of any two decisions on the same report started from the same version, approval against rejection or rejection against rejection, exactly one MUST succeed; the other MUST be refused as a conflict and MUST change nothing, including task progress (UC-3 acceptance).

**Errors and order of checks**

- **FR-020**: Every refusal MUST use the shared error shape from feature 001: a stable code, a message that says what went wrong, and optional details such as the current status or the current version.
- **FR-021**: A rejection MUST be checked in this order: identity, request format (including the reason's length when one is given), request key and version presence, existence of the report, permission for the report (BR-12, and a `DRAFT` is treated as not permitted), then version (BR-15), status (BR-10 and Report lifecycle), and reason present and not blank (BR-8; Clarifications). This is feature 003's order for approval, with the reason in place of progress. A caller who fails an earlier check learns nothing from a later one.

**End to end and walkthrough**

- **FR-022**: The PRD example MUST pass as one automated check, row by row, as User Story 5 describes.
- **FR-023**: Each PRD implementation goal (safe retries, no silent overwrites, atomic approval) MUST have a passing automated check that exercises it through the system as a whole.
- **FR-024**: The manual walkthrough MUST cover the whole PRD example, continuing features 002 and 003: both submissions, Linda's approval of Mark's report, her rejection of Henry's report with the PRD's reason, Henry's edit to 5% and resubmission, and Linda's approval.
- **FR-025**: The setup instructions MUST describe what the walkthrough does, and MUST match it.

### Key Entities

- **Daily Report** (feature 002): gains its path to `REJECTED`, and from it back to `SUBMITTED`. Status, version and history change on rejection; items do not.
- **Transition** (feature 002): a rejection adds one, from `SUBMITTED` to `REJECTED`, with the Site Supervisor as actor and a required reason. A resubmission adds one from `REJECTED` to `SUBMITTED`.
- **Rejection reason**: the text a Site Supervisor gives when rejecting. Stored on the rejection transition; not a separate record and not stored on the report itself.
- **Task** (feature 001): not changed by rejection, editing or resubmitting.
- **Worksite** (feature 001): read for its Site Supervisor (BR-12). Its status is not checked at rejection (BR-3).
- **Request key record** (feature 002): used unchanged for rejections.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The PRD example, run as one automated check, matches all 4 rows of the PRD's approved progress table, with Build ground-floor walls ending at 55% and Install electrical at 5%.
- **SC-002**: Across reject, edit and resubmit, 0 tasks' approved progress changes until the final approval (UC-4 acceptance).
- **SC-003**: Of 2 decisions on the same report, one approval and one rejection, started at the same moment, exactly 1 succeeds and 1 is refused as a conflict, and exactly 1 new transition exists afterwards (UC-3 acceptance).
- **SC-004**: 100% of rejection attempts by a Foreman or by the Site Supervisor of another worksite are refused as not permitted, and 0 of them change any data.
- **SC-005**: 100% of rejections with a missing, empty or blank reason are refused, and 0 rejection transitions without a reason exist.
- **SC-006**: After a rejection, the author can read the reason in 1 step, by viewing the report, and it is also in the response to their next save or submission.
- **SC-007**: 5 identical rejection requests with the same request key yield 1 rejection transition and 5 identical responses.
- **SC-008**: Each of the PRD's 3 implementation goals has at least 1 passing automated check through the system as a whole.
- **SC-009**: A person new to the project can reproduce every row of the PRD example table by following only the setup instructions and the manual walkthrough.

## Assumptions

### Scope boundaries

- In scope: UC-4 Reject and resubmit, with BR-8, BR-12 and BR-15 for rejection, BR-10, BR-11 and BR-14 applied to rejection, and the approve-against-reject race of UC-3. Editing and resubmitting a `REJECTED` report, already allowed by feature 002, verified here with a real path to `REJECTED`. The whole PRD example, automated and by hand.
- Out of scope: withdrawing or editing a submitted report (PRD, Out of scope); returning a rejected report to `DRAFT` (PRD, Report lifecycle); lowering approved progress; creating worksites, adding and reassigning tasks (feature 005); closing a worksite as an action (open question P3); listing reports awaiting a decision; notifications, including telling the Foreman a report was rejected (PRD, Out of scope).
- A closed worksite and a reassigned task appear in this feature only as prepared test data, as in features 002 and 003.

### The plan's questions for clarify

The plan lists two questions for `/speckit-clarify`:

- **Is there a maximum length for the rejection reason?** Settled under Clarifications: 2,000 characters of plain text, the limit feature 002 set for notes, so every free text in a report has one limit (FR-003).
- **Does the Foreman see the reason only by viewing the report, or also in the response to the next save?** Both. Every response that returns a report includes its full history with reasons (feature 002, FR-031, FR-034), so this needs no new decision (FR-011).

### Other assumptions

- **A reason of only whitespace is no reason** (BR-8). Accepting it would satisfy the rule in form only.
- **A rejection carries the reason and nothing else** besides the version and request key, as an approval carries only the version (feature 003).
- **Reason checked last** (Clarifications). BR-8, for a missing reason as for an empty or blank one, is checked after permission, version and status, so a caller who may not reject, or rejects from an old version, learns nothing about the reason, and the loser of a race always gets a conflict.
- **Rejecting a `REJECTED` report** states the status, because the Site Supervisor can view it. A `DRAFT` is refused as not permitted instead, as for approval in feature 003.
- **Editing is not required before resubmitting.** UC-4 says the Foreman "edits and resubmits", but neither the rules nor the lifecycle require a change in between, and the Foreman may answer the rejection by keeping the figures. Feature 002 already allows it.

### Conflicts between documents, stated for decision

- **UC-4's "Applies" line does not list BR-10**, although rejecting an `APPROVED` report is refused by it, and the implementation plan's Step 4 tests it. BR-10's text ("cannot ... change status") applies to every transition, so this spec applies it to rejection (FR-008). No product change is needed unless the product owner wants the line aligned.
- **UC-4 does not list BR-3, BR-4, BR-5 and BR-7**, which apply when the Foreman edits and resubmits. Those steps are UC-1 (save) and UC-2 (submit a draft or a rejected report), whose "Applies" lines list them, so this is consistent, not a conflict; it is noted so the plan does not miss them.
- **A rejected report on a worksite closed later cannot be resubmitted** (Edge Cases). The rules allow the rejection and refuse the resubmission. No document says what should happen to such a report. Decided (Clarifications): this spec keeps the rules as written, and the question goes to the product owner as P6 in the implementation plan. Closing a worksite has no action yet (P3).

### Dependencies

- Feature 001: users and roles, worksites with their Site Supervisor and status, tasks with assignee and approved progress, the example data, the shared error shape.
- Feature 002: saving and submitting, including on a `REJECTED` report; versions, transitions, request keys, the report view, and the walkthrough.
- Feature 003: approval, its order of checks, its refusal of a `DRAFT`, and the walkthrough this feature completes.
- `docs/product/` as of 93912c8.
