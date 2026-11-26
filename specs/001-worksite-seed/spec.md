# Feature Specification: Worksite seed and identity check

**Feature Branch**: `001-worksite-seed`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "step 1 of the plan 001-worksite-seed, make sure you follow architect, document and scope of the step"

**Source**: [Implementation plan, Step 1](../../docs/engineering/implementation-plan.md#step-1-001-worksite-seed). Related: [PRD](../../docs/product/prd.md) (Roles, Example), [Glossary](../../docs/glossary.md), [Use cases](../../docs/product/use-cases.md).

**Business rules implemented**: none. This feature lays the identity and data foundation that UC-1 to UC-4 and BR-1 to BR-15 rely on in later features. The worksite status it introduces is what BR-3 will check in feature 002.

## Clarifications

### Session 2026-11-26

- Q: When a Foreman views a worksite, should they see every task in it, or only the tasks assigned to them? → A: Only the tasks assigned to them. The Site Supervisor sees every task.
- Q: When the example is loaded again, what happens to example rows that already exist and have changed since? → A: Starting the system only adds missing example rows and never changes existing ones. Loading the example on purpose, by running the seed command, resets the example rows to the PRD values.
- Q: In the worksite view, how are the worksite's Site Supervisor and each task's assignee shown? → A: By their user identifier only, with no name or role.
- Q: Should a refusal for an unknown user identifier look the same to the caller as a refusal for a role that does not match the stored role? → A: Yes, the same code and message. The reason is recorded for operators only.
- Q: In what order are the tasks listed in the worksite view? → A: Every stored record keeps the time it was created and the time it was last changed. Lists are always ordered by last-changed time, most recent first. Ties fall back to creation time, oldest first, then to the identifier.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View a worksite and its tasks (Priority: P1)

A known user asks for a worksite and sees its name, status and Site Supervisor, with each task's assignee and approved progress. Both roles may view worksites and tasks (PRD, Roles). A Site Supervisor sees every task of the worksite. A Foreman sees only the tasks assigned to them.

**Why this priority**: Viewing a worksite is the first thing either role does, and every later feature needs it. A Foreman picks tasks from this view to report on, and the Site Supervisor checks approved progress here after an approval.

**Independent Test**: Load a worksite with tasks assigned to two Foremen. Ask for it as a Site Supervisor and as each Foreman, and compare each result with the stored data: the Site Supervisor gets every task, each Foreman only their own. Ask for an identifier that does not exist and confirm it is reported as not found.

**Acceptance Scenarios** (people are named for readability; the view shows their user identifiers):

1. **Given** the example data is loaded, **When** Linda (Site Supervisor) asks for the "Three-storey townhouse" worksite, **Then** Linda sees the worksite as `ACTIVE`, supervised by Linda, with three tasks: Pour foundation (Mark, 100%), Build ground-floor walls (Mark, 40%), Install electrical (Henry, 0%).
2. **Given** the example data is loaded, **When** Mark (Foreman) asks for the same worksite, **Then** Mark sees the same worksite details and two tasks: Pour foundation (Mark, 100%) and Build ground-floor walls (Mark, 40%). Install electrical is not listed.
3. **Given** the example data is loaded, **When** Henry (Foreman) asks for the same worksite, **Then** Henry sees the same worksite details and one task: Install electrical (Henry, 0%).
4. **Given** a Foreman with no tasks in a worksite, **When** they ask for that worksite, **Then** they see the worksite details with an empty task list. The request is not refused.
5. **Given** a known user, **When** they ask for a worksite identifier that does not exist, **Then** the request is refused as not found, and the response names the identifier that was not found.
6. **Given** a worksite with no tasks, **When** a known user asks for it, **Then** they see the worksite with an empty task list.
7. **Given** the example data is loaded and Build ground-floor walls is then changed, **When** Linda asks for the worksite, **Then** Build ground-floor walls is listed first, followed by the other two tasks in the order they were added.

---

### User Story 2 - Unknown callers are rejected (Priority: P1)

Every request, except the liveness check, must come from a user the system knows, acting in the role stored for that user. The PRD has no authentication (Out of scope): the caller states their identity and role with each request, and the system checks both against its list of users.

**Why this priority**: Every rule in later features (who may report, who may approve) depends on knowing who the caller is. If the system accepted any stated identity or role, a Foreman could act as a Site Supervisor by claiming the role, and the PRD's separation between author and approver would not hold.

**Independent Test**: Send a request to view a worksite with no identity, with a malformed identity, with an identity not in the list of users, and with a known identity but the wrong role. Each is refused as unauthenticated, and none of them reveals worksite data. The liveness check still answers without an identity.

**Acceptance Scenarios**:

1. **Given** no identity or role is supplied, **When** a caller asks for a worksite, **Then** the request is refused as unauthenticated, and the message states what identity information is required.
2. **Given** an identity in the right format that belongs to no known user, **When** the caller asks for a worksite, **Then** the request is refused as unauthenticated.
3. **Given** Mark's identity with the Site Supervisor role, **When** Mark asks for a worksite, **Then** the request is refused as unauthenticated, because Mark's stored role is Foreman.
4. **Given** Linda's identity with the Foreman role, **When** Linda asks for a worksite, **Then** the request is refused as unauthenticated, with the same code and message as in scenario 2.
5. **Given** an identity that is not in the expected format, or a role that is not one of the two roles in the glossary, **When** the caller asks for a worksite, **Then** the request is refused as unauthenticated.
6. **Given** no identity is supplied, **When** a caller requests the liveness check, **Then** it answers normally.

---

### User Story 3 - The PRD example is present after startup (Priority: P2)

When the system starts, it contains the townhouse example from the PRD: Linda, Mark and Henry, the "Three-storey townhouse" worksite, and its three tasks with their assignees and approved progress. Nobody has to enter this data by hand. Starting the system again adds only what is missing and never changes existing data, so progress earned through approvals survives. A developer who wants a clean example runs the seed command on purpose, which resets the example users, worksite and tasks to the values in the PRD.

**Why this priority**: Until feature 005 adds worksite management, this example is the only way to get worksites, tasks and users into the system. Features 002 to 004 run the PRD example against this data. It is P2 because User Stories 1 and 2 can be tested with any data, but no one can use the started system without it.

**Independent Test**: Start the system from an empty store and check that the example users, worksite and tasks are present with the values in the PRD. Change an example task's approved progress and start the system again: each example row still exists exactly once, and the changed value is kept. Then run the seed command on purpose: the changed value is back to the PRD value.

**Acceptance Scenarios**:

1. **Given** an empty system, **When** it starts, **Then** it contains three users: Linda (Site Supervisor), Mark (Foreman) and Henry (Foreman).
2. **Given** an empty system, **When** it starts, **Then** it contains the worksite "Three-storey townhouse", `ACTIVE`, supervised by Linda, with the tasks Pour foundation (Mark, 100%), Build ground-floor walls (Mark, 40%) and Install electrical (Henry, 0%).
3. **Given** a system that already contains the example, **When** the system starts again or the seed command is run, **Then** each user, worksite and task exists exactly once, and their identifiers are unchanged.
4. **Given** Build ground-floor walls has approved progress 55% after an approval, **When** the system starts again, **Then** its approved progress is still 55%.
5. **Given** Build ground-floor walls has approved progress 55%, **When** a developer runs the seed command on purpose, **Then** its approved progress is 40% again, and every other example value is the PRD value.
6. **Given** the system has started, **When** a person follows the manual walkthrough, **Then** they can view the townhouse worksite as Linda using the fixed identifiers the walkthrough gives, without looking anything up.

---

### Edge Cases

- **Identifier that is not well-formed**: a worksite identifier that does not have the expected format is refused as an invalid request, stating the expected format. It is not looked up.
- **Approved progress out of range**: approved progress outside 0 to 100 is refused when stored, whatever writes it: the example data, a test, or a later feature. The stored data never holds such a value.
- **Approved progress not supplied**: a task created without approved progress starts at 0%.
- **Role supplied in a different letter case**: a role is accepted only when it matches a glossary role exactly (`FOREMAN`, `SITE_SUPERVISOR`).
- **Closed worksite**: a `CLOSED` worksite can still be viewed by any known user, and its status is shown. Nothing in this feature closes a worksite (implementation plan, section 3).
- **Unknown route**: a request for an address the system does not serve is refused as not found, with a code that says the route does not exist. This is distinct from a worksite that does not exist.
- **Unreadable request body**: a request whose body is not valid structured data is refused as malformed. A refusal for this reason never reaches the identity or worksite logic.
- **Request identifier**: every response carries a request identifier. A safe identifier supplied by the caller is echoed back. A missing or unsafe one is replaced by a newly generated identifier.
- **Example data changed before a restart**: starting the system keeps the changed values, including approved progress that an approval raised. Only running the seed command on purpose resets them. Other users, worksites and tasks are never touched.
- **Tasks changed at the same moment**: tasks written together, such as the three seeded townhouse tasks, can share a last-changed time. They are listed by creation time, then by identifier, so the order never varies between requests.
- **Order of checks**: an unknown caller asking for a worksite that does not exist is refused as unauthenticated, not as not found, so an unknown caller learns nothing about which worksites exist.

## Requirements *(mandatory)*

### Functional Requirements

**Identity**

- **FR-001**: Every request except the liveness check MUST state the caller's user identifier and role.
- **FR-002**: The system MUST refuse as unauthenticated a request whose identifier or role is missing, has the wrong format, or names a role outside the glossary.
- **FR-003**: The system MUST refuse as unauthenticated a request whose identifier does not belong to a known user.
- **FR-004**: The system MUST refuse as unauthenticated a request whose stated role differs from the role stored for that user.
- **FR-005**: An unauthenticated refusal MUST state what the caller has to supply, and MUST NOT reveal whether the identifier belongs to a user. A refusal for an unknown identifier and a refusal for a mismatched role MUST have the same code and the same message.
- **FR-005a**: For each unauthenticated refusal, the system MUST record the actual reason (missing, malformed, unknown user, role mismatch) where operators can see it, and MUST NOT return it to the caller.
- **FR-006**: Each user MUST have exactly one role, `FOREMAN` or `SITE_SUPERVISOR` (glossary; PRD, Roles).

**Viewing a worksite**

- **FR-007**: A known user of either role MUST be able to view any worksite by its identifier (PRD, Roles: "View worksites, tasks, and reports").
- **FR-008**: The worksite view MUST include the worksite's identifier, name, status and its Site Supervisor's user identifier, and the tasks the caller may see (FR-008a).
- **FR-008a**: A Site Supervisor MUST see every task of the worksite. A Foreman MUST see only the tasks currently assigned to them, and an empty task list when they have none in that worksite.
- **FR-009**: Each task in the view MUST include its identifier, name, its assignee's user identifier and its approved progress. The view MUST NOT include user names or roles.
- **FR-010**: The view MUST list tasks by last-changed time, most recent first. Tasks with the same last-changed time MUST be listed by creation time, oldest first, then by identifier, so the order is the same on every request for the same data.
- **FR-011**: Viewing a worksite identifier that does not exist MUST be refused as not found.
- **FR-012**: Viewing a worksite MUST NOT change any data.

**Data**

- **FR-013**: A worksite MUST have exactly one Site Supervisor and a status of `ACTIVE` or `CLOSED` (glossary, Worksite).
- **FR-014**: A task MUST belong to exactly one worksite and have exactly one assignee (glossary, Task and Assignee).
- **FR-015**: Approved progress MUST be an integer from 0 to 100, and MUST start at 0 when not given (glossary, Progress). The stored data MUST refuse any other value, so no part of the system can bypass the range.
- **FR-015a**: Every stored user, worksite and task MUST record when it was created and when it was last changed, as a timestamp with its time zone. The creation time MUST never change. The last-changed time MUST be updated on every change to the record. Records added by later features follow the same rule.

**Example data**

- **FR-016**: Starting the system MUST load the PRD's townhouse example with no manual step: the users, worksite and tasks listed in User Story 3.
- **FR-017**: The example MUST use fixed identifiers, the same on every installation, so the walkthrough and later features can refer to them.
- **FR-018**: Loading the example, by any route, MUST leave exactly one copy of each example user, worksite and task. Rows that are not part of the example MUST NOT be changed.
- **FR-018a**: Starting the system MUST only add missing example rows. It MUST NOT change an example row that already exists, including its last-changed time.
- **FR-018b**: Running the seed command on purpose MUST reset the example rows to the PRD values (names, roles, Site Supervisor, status, assignees, approved progress) and add any that are missing.
- **FR-019**: The manual walkthrough MUST include viewing the townhouse worksite as Linda, and MUST state which example user each fixed user identifier belongs to, because the view shows identifiers only. The setup instructions MUST describe the example data that is loaded.

**Request handling** (applies to every request, verified in this feature)

- **FR-020**: Every refusal MUST use the one error shape shared by all endpoints: a code, a message that says what went wrong and how to fix it, and optional details (architecture.md, section 4.2).
- **FR-021**: A request to an address the system does not serve MUST be refused as not found, with a code that identifies an unknown route.
- **FR-022**: A request whose body is not valid structured data MUST be refused as malformed.
- **FR-023**: Every response MUST carry a request identifier: the caller's own when it is safe to record, otherwise a newly generated one.

### Key Entities

- **User**: a person who uses the system. Has a name and exactly one role. Users are not created or changed through the system in this feature; they come from the example data. The PRD's model has this entity, but the glossary has no entry for it (implementation plan, open question P5).
- **Role**: `FOREMAN` or `SITE_SUPERVISOR`, spelled as in the glossary.
- **Worksite**: a construction site under way. Has a name, one Site Supervisor (a user), a status of `ACTIVE` or `CLOSED`, and many tasks.
- **Task**: a unit of construction work within one worksite. Has a name, exactly one assignee (a Foreman) and an approved progress from 0 to 100.
- **Every entity above** also records when it was created and when it was last changed (FR-015a).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a fresh start, with no manual step, the first request from Linda to view the townhouse returns 3 tasks with approved progress 100%, 40% and 0%.
- **SC-002**: Linda sees 3 tasks, Mark sees 2 and Henry sees 1, and 0 tasks assigned to another Foreman appear in a Foreman's view.
- **SC-003**: 100% of requests with a missing, malformed, unknown or mismatched identity are refused, and 0 of them return any worksite data.
- **SC-004**: After the system is started, or the example loaded, 2 or more times, the system holds exactly 3 users, 1 worksite and 3 tasks from the example, with unchanged identifiers. Starting the system changes 0 existing example values. After the seed command is run on purpose, 100% of example values equal the PRD example.
- **SC-005**: 0 tasks with approved progress outside 0 to 100 can be stored, whatever path attempts the write.
- **SC-006**: A person new to the project can view the townhouse worksite as Linda by following only the setup instructions and the manual walkthrough.
- **SC-007**: Every refusal in this feature (unauthenticated, not found, invalid identifier, unknown route, malformed body) states what went wrong in the shared error shape, so the caller can correct the request without reading the code.

## Assumptions

### Scope boundaries

- In scope: viewing one worksite and its tasks; checking the caller's identity and role against the known users; loading the PRD example at startup.
- Out of scope: listing worksites; creating or changing users, worksites or tasks through the system (feature 005); closing a worksite (no action in the PRD or the plan); daily reports and every business rule BR-1 to BR-15 (features 002 to 005); authentication and account management (PRD, Out of scope).

### Decisions carried from the implementation plan

These were settled before the Spec-Kit work (implementation plan, section 3) and are applied here, not reopened.

- An unknown user identifier, or a stated role that differs from the stored role, is refused as unauthenticated.
- The two roles are spelled exactly as in the glossary.
- Approved progress is limited to 0 to 100 by the stored data itself, not only by the code that writes it.
- Viewing a worksite reads the current data. There is no separate copy kept for reading.
- `CLOSED` is set only by the example data and by tests. No action closes a worksite.

### The plan's questions for clarify

The plan lists two questions for clarify. The first, whether a Foreman sees every task, is settled under Clarifications. The second is settled as follows.

- **The view includes each task's assignee and approved progress.** Basis: the plan's exit criterion checks approved progress 100, 40 and 0. Including the assignee lets a Foreman see which tasks they may report on (BR-4, feature 002). The assignee is shown by identifier only (Clarifications).

### Other assumptions

- Any known user may view any worksite, including one they neither supervise nor have tasks in. The PRD sets no limit, and with one worksite in the example this has no practical effect yet. A Foreman with no tasks there sees an empty task list (FR-008a).
- The implementation plan's step 1 API test expects Mark to receive three tasks. That test no longer matches this spec: Mark receives two. The spec is the source of truth for this step (implementation plan, introduction).
- A worksite identifier with the wrong format is refused as an invalid request, not as not found.
- "Lists are always ordered by last-changed time" (Clarifications) applies to every list the system returns, in this feature and later ones, unless a later spec records an exception. Feature 002 should confirm it for a report's history of transitions, which readers may expect oldest first.
- The example's fixed identifiers and creation times are chosen so that, while no townhouse task has changed, the tasks are listed in the PRD's order: Pour foundation, Build ground-floor walls, Install electrical.
- The worksite view does not show creation or last-changed times in this feature. They are used for ordering only.
- Running the seed command on purpose (FR-018b) counts as a change, so it updates the last-changed time of every example row it rewrites.
- The behaviors in FR-020 to FR-023 may already exist in the application skeleton. This feature makes sure they are covered by tests that go through the whole application, because the first module endpoint arrives here.

### Dependencies

- Step 0 of the implementation plan: Spec-Kit is set up and committed (`chore: set up Spec-Kit`). The constitution's v1.1.0 amendment is not committed yet.
- **Note for feature 003**: running the seed command on purpose (FR-018b) can lower a task's approved progress without an approval, so approved reports may then disagree with task progress. This is a developer tool for resetting the example, not a product action. The normal start (FR-018a) never lowers approved progress, which matches the glossary and the PRD (Out of scope: "Lowering a task's approved progress").
- Open product question P5 (a glossary entry for "User"). This feature uses "user" as the PRD model does. The glossary changes only through the product owner.
