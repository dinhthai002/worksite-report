# Worksite Report Constitution

## Core Principles

### I. Documents First

Behavior is defined in `docs/product/` before any code is written, and code follows the documents.

- When two sources disagree, the higher one in this order wins and the lower one is corrected:
  `docs/product/use-cases.md`, `docs/product/prd.md`, `docs/glossary.md`, `docs/adr/`,
  `docs/engineering/architecture.md`, `docs/engineering/coding-standard.md` and
  `docs/engineering/testing.md`, then `specs/`.
- A conflict between a document and a request MUST be stated and decided by a person. It MUST NOT
  be resolved silently in a spec, plan or code.
- Files under `docs/product/` and `docs/adr/` MUST NOT change as a side effect of a coding task.
  They change only by a deliberate, separately approved edit.
- A behavior change updates the affected documents in the same commit series.

Rationale: code that disagrees with the documents is a bug in one of them. Only an explicit decision
says which one.

### II. A Person Approves Every Step

An agent may draft specs, plans, tasks and code. A person reads and approves each artifact before the
next Spec-Kit step starts.

- A step is done when its gate passes (workflow.md, section 3), not when the agent says so.
- Reports of a step's result MUST include the actual output of the checks that were run.

Rationale: the human decides and the agent drafts. Automated gates are the final safeguard.

### III. Rules Live in the Domain, Behind Enforced Boundaries

The backend is a modular monolith (architecture.md, sections 1 and 3) with the modules `worksite`
and `reporting`. Each module has four layers and a public `index.ts`:

| Layer | Holds |
| --- | --- |
| `interface/` | Express routes and Zod request schemas |
| `application/` | Use cases, one business action per file |
| `domain/` | Aggregates, entities, value objects, repository ports. Plain TypeScript, no I/O |
| `infrastructure/` | Prisma repositories and mappers that implement the domain ports |

`shared/domain` holds concepts every module uses (actor, clock, errors), and
`shared/infrastructure` holds config, logger, database client and HTTP middleware.

- Dependencies MUST point `interface` → `application` → `domain`, with `infrastructure`
  implementing domain ports. `domain` MUST import only `domain` and `shared/domain`, and
  `application` MUST NOT import `infrastructure` or `interface` (ARC-01, ARC-02).
- A module MUST be imported only through its `index.ts`. `worksite` MUST NOT import `reporting`,
  and `shared` MUST NOT import `modules` (ARC-03, ARC-04).
- A business rule MUST live in `domain`, be implemented once, and cite its ID: `// BR-5`
  (ARC-05, DOC-02).
- Each use case MUST be one file with one public `execute` method. Route handlers MUST only parse
  input, call one use case and map the result (ARC-06, ARC-07).
- Prisma types MUST NOT leave `infrastructure`; mappers convert rows to domain objects (ARC-08).
- Dependencies MUST be passed through constructors and wired by hand in `main.ts`. No module-level
  singletons except the logger (ARC-09).
- The current time MUST be read through `Clock`, never `new Date()` in `domain` or `application`
  (ARC-10).
- A state-changing request MUST follow the request flow in architecture.md section 6: request log,
  actor check, idempotency, schema validation, one use case, repository write, error handler.

Rationale: rules in one place, behind boundaries `dependency-cruiser` checks, stay testable without
I/O and cannot drift apart.

### IV. Type Safety, Naming and Comments

- TypeScript MUST run with `strict`, `noUncheckedIndexedAccess` and `noImplicitOverride` (TS-01).
- Code MUST NOT use `any`, `@ts-ignore`, the non-null assertion `!`, or `as unknown as T`
  (TS-02, TS-03).
- Exported functions and methods MUST declare a return type, and modules MUST use named exports
  only (TS-04, TS-07).
- A finite set of values MUST be a literal union, and a `switch` over a union MUST handle every
  case and end with `assertNever` (TS-05, TS-06).
- IDs SHOULD be branded types in `domain` and `application`: `WorksiteId`, `TaskId`, `ReportId`,
  `UserId` (TS-08).
- Files and directories MUST be `kebab-case`; classes and types `PascalCase`; functions and
  variables `camelCase`; constants `UPPER_SNAKE_CASE` (NAM-01, NAM-02).
- A use case file MUST be named after its action (`approve-report.ts` exports `ApproveReport`),
  and a file suffix MUST state its role: `.repository.ts`, `.mapper.ts`, `.routes.ts`,
  `.schemas.ts`, `.middleware.ts`, `.test.ts` (NAM-04, NAM-05).
- Database tables and columns MUST be `snake_case`, mapped in `schema.prisma`. Error codes MUST be
  stable `UPPER_SNAKE_CASE` (NAM-06, NAM-07).
- Comments SHOULD explain why, not what (DOC-01). Commented-out code and a `TODO` without an owner
  MUST NOT be committed (DOC-03).

Rationale: the compiler and Biome catch whole classes of mistakes, and predictable names let a
reader find a file from the concept it implements.

### V. Explicit Errors and One HTTP Contract

- `domain` and `application` MUST throw subclasses of `DomainError` with an error code, and MUST
  NOT know HTTP statuses (ERR-01).
- Domain errors MUST be mapped to HTTP statuses in `error-handler.ts` only (ERR-02), following
  architecture.md section 4.2: `400` invalid request, `401` actor missing or invalid, `403`
  forbidden, `404` not found, `409` stale `version` or a state that forbids the action, `422` a
  broken business rule or a reused request key, `500` anything else.
- Every error response MUST use the one shape
  `{ "error": { "code", "message", "details"? } }` (API-03).
- An empty `catch` MUST NOT be written. A caught error is handled, rethrown, or logged with
  context (ERR-03).
- Prisma errors MUST be translated at the repository; `P2002` becomes a domain conflict error
  (ERR-04).
- An unknown error MUST return `500` with a generic message. Details go to the log only (ERR-05).
- Every request body, path and query MUST be validated with a Zod schema before the use case is
  called (API-01).
- HTTP conventions MUST follow architecture.md section 4.1: identity in `X-Actor-Id` and
  `X-Actor-Role`; `Idempotency-Key` on every `POST` and `PUT` (API-02); a write to a versioned
  resource carries the `version` last read, and every report response includes the current
  `version` (API-04); dates as `YYYY-MM-DD`; timestamps as ISO 8601 with offset; `camelCase` field
  names.
- Endpoints are defined per feature in `specs/NNN-name/contracts/`. `GET /health` is the only
  endpoint outside a feature and needs no actor.

Rationale: a client handles every failure the same way, and the domain stays free of transport
concerns.

### VI. The Database Guards Integrity

- `@prisma/client` MUST be imported only in `infrastructure` and `shared/infrastructure` (DB-01).
- Uniqueness and value ranges MUST be enforced by database constraints, never by
  check-then-insert (DB-02). A constraint that `schema.prisma` cannot express (a `CHECK`, a
  trigger) MUST be added to the generated migration SQL before the migration is committed.
- Every write to a report MUST be conditional on its `version` and increment it. Zero rows updated
  MUST raise a conflict (DB-03, ADR 0003, BR-15).
- A use case that changes more than one row MUST use one `$transaction` (DB-04). A transaction
  across more than one aggregate MUST be recorded in an ADR (ADR 0004).
- Every `POST` and `PUT` MUST require an `Idempotency-Key`. The stored hash and response per actor
  and key replay a repeated request, and a reused key with a different hash is rejected (API-02,
  BR-14, architecture.md section 5.4).
- Schema changes MUST go through Prisma Migrate. A committed migration MUST NOT be edited (DB-05).
- Raw SQL MUST go only through `$queryRaw` with tagged templates (DB-06).
- Each feature designs its own tables in its `data-model.md`. A table is created by the feature
  that first uses it.

Rationale: the PRD's implementation goals (safe retries, no silent overwrites, atomic approval) hold
only if concurrent requests cannot get around them.

### VII. Every Business Rule Is Traceable and Tested

Tests follow testing.md. There are three layers:

| Layer | Checks | Database | Location |
| --- | --- | --- | --- |
| Unit | Business rules, state transitions, use case orchestration | None; ports use in-memory fakes | `test/unit/`, mirroring `src/` |
| Integration | Queries, mapping, constraints, transactions, optimistic locking | Real PostgreSQL | `test/integration/*.int.test.ts` |
| API | HTTP contract, roles, validation, idempotency, full flows | Real PostgreSQL | `test/api/*.api.test.ts` |

- A change MUST have the tests testing.md section 1.1 requires: unit tests for a rule or a use
  case, integration tests for a repository, mapper or migration, API tests for an endpoint, unit
  and API tests for middleware, and a test that fails before a bug fix, at the lowest layer that
  reproduces it.
- Every business rule BR-1 to BR-15 MUST have at least one test whose name starts with its ID.
  Test names MUST state behavior, not implementation (TST-01, TST-02).
- Each test MUST follow arrange, act, assert, with one behavior per test (TST-03).
- Unit tests MUST NOT touch the database, the network, the file system or the real clock. Time is
  controlled with `FixedClock` (TST-04, TST-05).
- Fakes MUST implement the same port as the real adapter and live in `test/fakes/`. No mocking
  library for ports (TST-06).
- Integration and API tests MUST run against real PostgreSQL in Testcontainers. No SQLite, no
  mocked Prisma client. Each test MUST start from truncated tables (TST-07, TST-08).
- Tests MUST be independent and pass in any order (TST-09). Test data SHOULD come from builders
  with valid defaults (TST-10).
- State transitions MUST be covered by a table-driven test over every pair of statuses (TST-11).
- A flaky test MUST be fixed or deleted. No retries, and no `skip` on the main branch. A failing
  test MUST NOT be weakened, skipped or deleted to make a check pass (TST-12).
- A unit test's path MUST mirror the file it tests, and tests import production code as
  `@src/...` (TST-13).
- Each endpoint's API tests MUST cover: the success response, including `version` where it
  applies; `400` validation failure; `401` and `403`; the `409` and `422` rule failures of its
  use case; and a repeated `Idempotency-Key` for writes (testing.md section 5).
- `domain` and `application` MUST keep at least 90% line and branch coverage. Coverage is a floor;
  TST-01 matters more.

Rationale: a rule ID that cannot be found in a test name is a rule nobody can prove holds.

### VIII. Observable, and Configured in One Place

- Logging MUST use the shared pino logger, never `console.log` (LOG-01).
- Each request MUST log one line with method, path, status, duration, actor ID and request ID
  (LOG-02).
- `process.env` MUST be read only in `config.ts`, and in `test/` where Jest's global setup passes
  `DATABASE_URL` (CFG-01).
- Configuration MUST be read once at startup, validated with Zod, and exposed read-only. The
  process exits on a missing or invalid value. The variables are listed in architecture.md
  section 7.
- No secrets or real connection strings MUST be committed (CFG-02).

Rationale: one log line per request and one source of configuration make a problem traceable from a
request ID to its cause.

### IX. One Vocabulary

Domain names in documents, specs and code MUST be the glossary terms, spelled exactly:
`Worksite`, `Foreman`, `SiteSupervisor`, `DailyReport`, `approvedProgress` (NAM-03). A missing term
is added to the glossary by its owner before it is used as if it were defined.

Rationale: one name per concept keeps the documents, the tests and the code searchable against each
other.

### X. Deliberate Simplicity

- Architecture section 1.2 is binding: no CQRS bus, no event sourcing, no domain events, no
  message queue, no dependency-injection container, and no authentication beyond the actor
  headers.
- A new dependency MUST NOT be added without a person's approval.
- A deviation from these principles MUST be justified in the plan's Complexity Tracking section,
  or recorded in an ADR when it changes the architecture.

Rationale: the system is small. Every extra mechanism has to earn its place.

## Technology and Quality Constraints

- The technology stack is fixed by architecture.md section 2: Node.js 22, TypeScript in strict mode
  compiled to CommonJS, Express 5, Zod at the HTTP boundary only, PostgreSQL 17, Prisma 6 with
  Prisma Migrate, pino, Jest with ts-jest, supertest and Testcontainers, Biome, dependency-cruiser,
  Docker Compose, GitHub Actions.
- Deployment follows architecture.md section 8: `docker compose up --build` starts `db`, then
  `migrate` (migrations, then the seed), then `api` with a `GET /health` healthcheck. The image is
  multi-stage and runs as a non-root user. `main.ts` shuts down gracefully on `SIGTERM`.
- CI runs, in order: `npm ci`, typecheck, `biome ci`, `depcruise src`, unit tests, integration and
  API tests, `docker build` (architecture.md section 9). Every step MUST pass.
- `npm run check` (typecheck, Biome, dependency-cruiser, unit tests) MUST pass before a task is
  reported done. `npm run test:all` and CI MUST pass before a feature is done.
- `tsconfig.json`, `biome.json`, `.dependency-cruiser.cjs` and the CI workflow MUST NOT be edited
  to make a check pass, and ignore comments MUST NOT be added.

## Development Workflow

- Each feature follows workflow.md section 3: specify, clarify, plan, tasks, analyze, implement,
  verify, commit. Each step has its gate.
- A spec names no technology. A plan follows the architecture and its dependency rules. Every rule
  in a spec maps to a task and a test.
- Within a task group, build in this order: domain and its unit tests, then the use case and its
  unit tests, then the repository and its integration tests, then the route and its API tests.
- Commits follow Conventional Commits, one logical change each. The build and tests pass at every
  commit, and a commit that changes behavior includes its tests (GIT-01 to GIT-03).
- Done means the behavior matches the use cases and rules it cites, every rule touched has a test
  named with its ID, the checks pass, and `docker compose up --build` starts with `GET /health`
  returning `200`.

## Governance

- This constitution summarizes docs/engineering/architecture.md, coding-standard.md, testing.md and
  workflow.md for Spec-Kit. If it disagrees with those documents, the documents win and the
  constitution is amended to match. Rule codes (ARC-01, TST-01, …) refer to those documents.
- `/speckit-plan` checks every plan against these principles in its Constitution Check. Reviews
  cite the rule code that a change breaks (for example `ARC-07`, `TST-01`).
- Amendments are made by a pull request that a person approves. The change states its reason and
  updates any document it affects.
- Versioning follows semantic versioning. MAJOR: a principle removed or redefined incompatibly.
  MINOR: a principle or section added, or guidance materially expanded. PATCH: wording and
  clarifications.

**Version**: 1.1.0 | **Ratified**: 2026-11-26 | **Last Amended**: 2026-11-26
