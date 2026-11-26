# Implementation Plan: Worksite seed and identity check

**Branch**: `001-worksite-seed` | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-worksite-seed/spec.md`

## Summary

The first module endpoint, `GET /worksites/:worksiteId`, and the foundation later features rely on:

- **Identity**: the actor middleware now checks `X-Actor-Id` and `X-Actor-Role` against a `users`
  table. Every failure returns one identical `401`, and the reason is logged.
- **Viewing**: a `Worksite` aggregate decides which tasks the caller sees. The Site Supervisor sees
  every task, a Foreman sees only their own.
- **Ordering**: tasks are listed by last-changed time, from timestamps the database maintains with a
  trigger.
- **Example data**: a seed loads the PRD townhouse example. On startup it only fills in missing
  rows. Run explicitly, it resets the example to the PRD values.

Approach and alternatives: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 6 (`strict`), Node.js 22.23.4

**Primary Dependencies**: Express 5, Zod 4, Prisma 6.19, pino. No new dependency (`tsx` is already
a dev dependency)

**Storage**: PostgreSQL 17. New tables `users`, `worksites`, `tasks`, two enums, one trigger
function

**Testing**: Jest 30 with ts-jest; Testcontainers (`postgres:17.11`) for integration and API tests;
supertest

**Target Platform**: Linux container (Docker Compose: `db`, `migrate`, `api`)

**Project Type**: Web service (modular monolith backend)

**Performance Goals**: none beyond normal interactive use. One worksite with three tasks; one
indexed query per view

**Constraints**: constitution v1.1.0; the architecture's dependency rules, checked by
dependency-cruiser

**Scale/Scope**: 3 users, 1 worksite, 3 tasks of example data. One read endpoint

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v1.1.0, before research and again after design.

| Principle | Result | How the design complies |
| --- | --- | --- |
| I. Documents First | Pass, with one recorded divergence | The spec governs this step (implementation plan, introduction). The plan's step 1 test row "200 with three tasks, for Lan and for Minh" contradicts the clarified spec (Mark gets 2), so it is updated in the same commit series. No edit to `docs/product/` or `docs/adr/` |
| II. A Person Approves Every Step | Pass | This plan awaits review before `/speckit-tasks` |
| III. Rules in the Domain, Boundaries | Pass | Visibility rule in `Worksite.tasksVisibleTo` (R5). `GetWorksite` is one file with `execute`. The route only parses, calls, maps. The user lookup is a `shared/domain` port, so `shared` never imports `worksite` (R1). Prisma types stay in mappers. Wiring in `main.ts` (R14) |
| IV. Types, Naming, Comments | Pass | `Role`, `WorksiteStatus` and the `UNAUTHENTICATED` reason are literal unions. `switch` on `Role` ends in `assertNever`. Branded `WorksiteId`, `TaskId`. File names follow NAM-04 and NAM-05 |
| V. Errors and HTTP Contract | Pass | `NotFoundError("WORKSITE_NOT_FOUND")` from the use case; statuses only in `error-handler.ts`; params, query and body validated by `withValidInput`, strict by default (API-01, R15); one `401` body ([contracts/identity.md](./contracts/identity.md)) |
| VI. Database Guards Integrity | Pass | Enums, foreign keys, `CHECK` on `approved_progress`, `updated_at` trigger (R3, R8). Migration via `prisma migrate dev` with the `CHECK` and trigger added by hand. Seed writes in one transaction. Truncation and raw test inserts use tagged `$queryRaw` (DB-06, R12) |
| VII. Rules Traceable and Tested | Pass | No BR in this feature. Every FR and scenario maps to a test below, at the layer testing.md 1.1 requires. Truncation helper (TST-08). `--passWithNoTests` removed |
| VIII. Observable, One Config | Pass | `401` reasons logged at `warn`; seed logs through pino. No new configuration variable |
| IX. One Vocabulary | Pass | `Worksite`, `Task`, `Foreman`, `SiteSupervisor`, `approvedProgress`, `Role.FOREMAN`. "User" has no glossary entry yet (open question P5); the spec uses the PRD model's term |
| X. Deliberate Simplicity | Pass | No new dependency, no new module, no `save` port before it is needed (R11) |

Re-check after Phase 1 design: unchanged, all pass. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/001-worksite-seed/
├── spec.md
├── plan.md               this file
├── research.md           Phase 0: decisions R1 to R15
├── data-model.md         Phase 1: domain model, tables, mapping, example data
├── quickstart.md         Phase 1: validation run
├── contracts/
│   ├── get-worksite.md   GET /worksites/:worksiteId
│   ├── identity.md       actor headers, 401, request handling
│   └── seed-command.md   fill and reset modes
├── checklists/requirements.md
└── tasks.md              Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

`+` new, `~` changed.

```text
prisma/
├── ~ schema.prisma                         enums UserRole, WorksiteStatus; models User, Worksite, Task
├── + migrations/<timestamp>_create_users_worksites_tasks/migration.sql
│                                           generated, plus hand-written CHECK and updated_at trigger
└── + seed.ts                               EXAMPLE, loadExample(client, "fill" | "reset"), CLI entry

src/
├── ~ app.ts                                AppDependencies gains users, getWorksite; mounts worksiteRoutes
├── ~ main.ts                               wires PrismaUserRepository, PrismaWorksiteRepository, GetWorksite
├── shared/
│   ├── domain/
│   │   ├── ~ actor.ts                      Role becomes a const object and type; ROLES, isRole kept
│   │   ├── + assert-never.ts               assertNever (TS-06)
│   │   └── + user.repository.ts            UserRepository port
│   └── infrastructure/
│       ├── + prisma-user.repository.ts     PrismaUserRepository
│       └── http/
│           ├── ~ actor.middleware.ts       async lookup; UnauthenticatedError with reason, one message;
│           │                               currentActor(res) for route handlers
│           ├── + validate-input.middleware.ts withValidInput(schemas, handler): params, query, body (R15)
│           └── ~ error-handler.ts          logs 401 reason at warn
└── modules/worksite/
    ├── domain/
    │   ├── + worksite.ts                   Worksite aggregate root, WorksiteId, WorksiteStatus, tasksVisibleTo
    │   ├── + task.ts                       Task entity, TaskId, isAssignedTo
    │   └── + worksite.repository.ts        WorksiteRepository port
    ├── application/
    │   └── + get-worksite.ts               GetWorksite, WorksiteView, TaskView
    ├── infrastructure/
    │   ├── + prisma-worksite.repository.ts findById with ordered tasks
    │   └── + worksite.mapper.ts            rows → Worksite
    ├── interface/
    │   ├── + worksite.schemas.ts           params schema: worksiteId UUID (query and body: none)
    │   └── + worksite.routes.ts            GET /worksites/:worksiteId through withValidInput
    └── ~ index.ts                          exports routes, use case, repository, domain types

test/
├── support/
│   ├── + database.ts                       truncateAll (TST-08)
│   ├── + test-app.ts                       builds the app with real adapters, like main.ts
│   └── + worksite.builder.ts               aWorksite(), aTask() with valid defaults (TST-10)
├── fakes/
│   ├── + in-memory-user.repository.ts
│   └── + in-memory-worksite.repository.ts
├── unit/
│   ├── shared/domain/~ actor.test.ts
│   ├── shared/infrastructure/http/~ actor.middleware.test.ts
│   ├── shared/infrastructure/http/~ error-handler.test.ts
│   ├── shared/infrastructure/http/+ validate-input.middleware.test.ts
│   └── modules/worksite/
│       ├── domain/+ task.test.ts
│       ├── domain/+ worksite.test.ts
│       └── application/+ get-worksite.test.ts
├── integration/
│   ├── + worksite.repository.int.test.ts
│   ├── + user.repository.int.test.ts
│   ├── + schema.int.test.ts                CHECK, defaults, updated_at trigger
│   └── + seed.int.test.ts
└── api/
    ├── + worksite.api.test.ts
    ├── + identity.api.test.ts
    └── + request-handling.api.test.ts

Other:
├── ~ package.json                          "prisma": { "seed": "tsx prisma/seed.ts --reset" }; test:int without --passWithNoTests
├── ~ tsconfig.build.json                   include prisma/seed.ts (emits dist/prisma/seed.js)
├── ~ docker-compose.yml                    migrate: `prisma migrate deploy && node dist/prisma/seed.js`
├── ~ http/report-flow.http                 view the townhouse as Linda, Mark, Henry; who is who
└── ~ README.md                             "Run it": example data, fill on start, reset command
```

**Structure Decision**: the existing modular monolith (architecture.md, section 3). This feature
fills in the `worksite` module and adds the user lookup to `shared`. `reporting` is untouched.

### Configuration files touched

`tsconfig.build.json` and `docker-compose.yml` change to ship and run the seed. Neither is on the
"do not edit to make a check pass" list, and both changes add behavior. `tsconfig.json`,
`biome.json`, `.dependency-cruiser.cjs` and the CI workflow are not touched.

### Documents updated in the same commit series

| Document | Change |
| --- | --- |
| `docs/engineering/architecture.md` §5 | New subsection: every table has `created_at` and `updated_at` (trigger-maintained); lists are ordered by `updated_at` descending, `created_at`, `id` |
| `docs/engineering/architecture.md` §8 | `migrate` row: runs `migrate deploy`, then the seed in fill mode |
| `docs/engineering/testing.md` §6 | Remove the `--passWithNoTests` sentence |
| `docs/engineering/implementation-plan.md` step 1 | Tests row: Linda gets 3 tasks, Mark 2, Henry 1. Persistence row: timestamps and trigger. Seed row: fill and reset |
| `README.md` | "Run it": the example data, fill on start, `npx prisma db seed` to reset |
| `specs/001-worksite-seed/spec.md`, `checklists/requirements.md` | Remove the stale "constitution is the template" notes |

## Test plan

Each row becomes at least one task (implementation plan, section 1, step 4). The build order
follows the constitution's development workflow: domain, use case, repository, route.

| Layer | Test | Covers |
| --- | --- | --- |
| Unit | `Role` holds exactly `FOREMAN` and `SITE_SUPERVISOR` | FR-006 |
| Unit | `Task.isAssignedTo`: true for the assignee, false for anyone else | FR-008a |
| Unit | `Worksite.tasksVisibleTo`: supervisor gets all, in order; Foreman gets own only; Foreman with none gets `[]` | FR-008a; US1-1 to US1-4 |
| Unit | `GetWorksite` returns the view with identifiers only; throws `WORKSITE_NOT_FOUND` naming the ID | FR-008, FR-009, FR-011; US1-5 |
| Unit | Actor middleware: missing, malformed, unknown, mismatched → `UnauthenticatedError`, same message, right reason; known user with right role passes | FR-001 to FR-005a |
| Unit | Error handler: `401` body has no reason; reason logged at `warn` | FR-005a |
| Unit | `withValidInput`: passes typed params, query, body; rejects a bad param, an unknown query key, and a body where none is declared, with issue paths `params.worksiteId`, `query` (message names the key) and `body`; accepts an absent or empty body when none is declared | API-01; R15 |
| Integration | Worksite repository round trip: rows load back as the expected aggregate | FR-008, FR-009 |
| Integration | Task order: `updated_at` desc, then `created_at`, then `id` | FR-010; US1-7 |
| Integration | `approved_progress` -1 and 101 rejected; default 0 | FR-015; SC-005 |
| Integration | `updated_at` advances on update, `created_at` does not | FR-015a |
| Integration | User repository: role for known ID, `undefined` for unknown | FR-003, FR-004 |
| Integration | Seed fill twice: one copy each | FR-018; SC-004 |
| Integration | Seed fill keeps a changed value and its `updated_at` | FR-018a; US3-4 |
| Integration | Seed reset restores PRD values; leaves non-example rows untouched | FR-018b; US3-5 |
| API | View as Linda (3 tasks, PRD values and order), Mark (2), Henry (1) | US1-1 to US1-3; SC-001, SC-002 |
| API | Worksite with no tasks; Foreman with no tasks there → `200`, `[]` | US1-4, US1-6 |
| API | Changed task listed first | US1-7 |
| API | Unknown ID → `404`; non-UUID → `400`; unknown query parameter → `400` | US1-5; edge case; API-01 |
| API | `401` for missing, malformed, unknown, mismatched; unknown and mismatched bodies identical; `401` before `404` | US2-1 to US2-5; SC-003 |
| API | `/health` without headers → `200` | US2-6 |
| API | `ROUTE_NOT_FOUND`, `MALFORMED_JSON`, `X-Request-Id` echoed or generated | FR-020 to FR-023; SC-007 |
| Manual | [quickstart.md](./quickstart.md) sections 2 to 5 | US3-1, US3-2, US3-6; SC-006 |

## Complexity Tracking

No constitution violations. Nothing to justify.
