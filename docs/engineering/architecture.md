# Architecture

- Scope: how the Site Daily Report backend is organized, built, and run.
- Related documents: [PRD](../product/prd.md), [Use cases and business rules](../product/use-cases.md), [Glossary](../glossary.md), [Coding standard](./coding-standard.md), [Testing](./testing.md), [Workflow](./workflow.md), [ADRs](../adr/).
- Code samples in this document illustrate the design. The source of truth is the code in `src/`.

## 1. Overview

A modular monolith following DDD tactical patterns: one codebase, one Docker image, one HTTP entrypoint. There are two modules, `worksite` and `reporting`, each split into four layers.

```
 interface/        Express routes · Zod request schemas
        │
        ▼
 application/      Use cases (one file = one business action)
        │
        ▼
 domain/           Aggregates · Entities · Value objects · Repository ports
        ▲          (plain TypeScript, no I/O imports)
        │
 infrastructure/   Prisma repositories · Mappers

 shared/           Actor · Clock · Errors · Prisma client · Logger · HTTP middleware
```

### 1.1 Dependency rules

Checked by `dependency-cruiser` in CI.

- `interface` → `application` → `domain`. `infrastructure` implements the ports declared in `domain`.
- `domain` imports nothing outside `domain` and `shared/domain`. No `express`, no `@prisma/client`, no `zod`.
- A module is imported only through its `index.ts`. `reporting` may import `worksite`. `worksite` never imports `reporting`.
- `shared` does not import `modules`.

### 1.2 What is deliberately left out

- No CQRS bus, no event sourcing, no domain events, no message queue.
- No dependency injection container. Dependencies are wired by hand in `main.ts`.
- No authentication. The caller's identity and role arrive in request headers (see 5.1).

## 2. Tech stack

| Concern | Choice |
| --- | --- |
| Runtime | Node.js 22 LTS |
| Language | TypeScript 6, `strict`, compiled to CommonJS |
| HTTP | Express 5 |
| Validation | Zod, at the HTTP boundary only |
| Database | PostgreSQL 17 |
| Data access | Prisma ORM 6, with Prisma Migrate |
| Logging | pino, structured JSON |
| Tests | Jest with ts-jest, supertest, Testcontainers |
| Lint and format | Biome |
| Architecture checks | dependency-cruiser |
| Packaging and deployment | Docker, Docker Compose |
| CI | GitHub Actions |

## 3. Directory structure

```
site-daily-report/
├── README.md
├── AGENTS.md
├── CLAUDE.md               imports AGENTS.md
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── package.json
├── tsconfig.json
├── tsconfig.build.json     compiles src/ to dist/
├── biome.json
├── biome-plugins/          GritQL rules for TS-03 and ARC-10
├── .dependency-cruiser.cjs
├── jest.config.js          projects: unit, integration, api
├── .env.example
├── .editorconfig
├── .gitignore
├── .nvmrc                  Node.js version for local work and CI
├── .github/workflows/ci.yml
│
├── docs/
│   ├── glossary.md
│   ├── product/            prd.md, use-cases.md
│   ├── engineering/        architecture.md, coding-standard.md, testing.md, workflow.md
│   └── adr/
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
│
├── http/
│   └── report-flow.http    manual walkthrough of the main flow
│
├── src/
│   ├── main.ts             wiring, listen, graceful shutdown
│   ├── app.ts              builds the Express app, does not listen
│   ├── config.ts           typed, read-only configuration
│   │
│   ├── modules/
│   │   ├── worksite/
│   │   │   ├── domain/           worksite.ts, task.ts, worksite.repository.ts
│   │   │   ├── application/      create-worksite.ts, add-task.ts, assign-task.ts
│   │   │   ├── infrastructure/   prisma-worksite.repository.ts, worksite.mapper.ts
│   │   │   ├── interface/        worksite.routes.ts, worksite.schemas.ts
│   │   │   └── index.ts
│   │   │
│   │   └── reporting/
│   │       ├── domain/           daily-report.ts, report-item.ts, report-status.ts,
│   │       │                     work-date.ts, daily-report.repository.ts
│   │       ├── application/      save-draft.ts, submit-report.ts,
│   │       │                     approve-report.ts, reject-report.ts
│   │       ├── infrastructure/   prisma-daily-report.repository.ts, daily-report.mapper.ts
│   │       ├── interface/        report.routes.ts, report.schemas.ts
│   │       └── index.ts
│   │
│   └── shared/
│       ├── domain/               progress.ts, actor.ts, clock.ts, errors.ts
│       └── infrastructure/       db.ts, system-clock.ts, logger.ts,
│                                 http/ (actor.middleware.ts, idempotency.middleware.ts,
│                                        request-log.middleware.ts, error-handler.ts,
│                                        health.routes.ts)
│
└── test/
    ├── setup.ts                  Testcontainers bootstrap (Jest globalSetup)
    ├── teardown.ts               stops the container (Jest globalTeardown)
    ├── test-database.ts          container state shared by setup and teardown
    ├── fakes/                    in-memory fakes for ports, FixedClock
    ├── unit/                     mirrors src/: src/a/b.ts is tested in test/unit/a/b.test.ts
    ├── integration/              repositories against real PostgreSQL
    └── api/                      HTTP flows through the full app
```

`src/` holds production code only. Unit tests live in `test/unit/`, at the same relative path as the file they test (TST-13), and import it as `@src/...`.

## 4. Domain model

### 4.1 Aggregates

| Aggregate | Root | Contains | Invariants it protects |
| --- | --- | --- | --- |
| Worksite | `Worksite` | `Task` entities | BR-3, BR-12, BR-13 |
| Daily Report | `DailyReport` | `ReportItem` entities | BR-4 to BR-8, BR-10 |

Value objects: `Progress` (integer from 0 to 100), `WorkDate` (calendar date, validates BR-2 against a `Clock`), `ReportStatus`.

### 4.2 Report state machine

The four transitions live in one table in `daily-report.ts`. Each method on the aggregate (`submit`, `approve`, `reject`) looks up the table and throws a domain error on an invalid transition.

```ts
const TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REJECTED"],
  REJECTED: ["SUBMITTED"],
  APPROVED: [],
};
```

### 4.3 Approval crosses two aggregates

Approving a report changes the `DailyReport` aggregate and the `approvedProgress` of tasks in the `Worksite` aggregate. Both changes are written in **one database transaction**, because BR-9 requires all-or-nothing. This is a deliberate departure from the one-aggregate-per-transaction guideline and is recorded in an ADR.

## 5. HTTP API

### 5.1 Conventions

| Topic | Convention |
| --- | --- |
| Identity | `X-Actor-Id` and `X-Actor-Role` headers (`FOREMAN` or `SITE_SUPERVISOR`). Missing or unknown: `401` |
| Safe retries (BR-14) | `Idempotency-Key` header, required on every `POST` and `PUT` |
| Concurrency (BR-15) | The request body carries the `version` the client last read. Every response returns the current `version` |
| Work date | `YYYY-MM-DD` in the path |
| Timestamps | ISO 8601 with offset |
| Field names | `camelCase` |

### 5.2 Endpoints

| Method and path | Use case | Role |
| --- | --- | --- |
| `POST /worksites` | Create a worksite | Site supervisor |
| `GET /worksites/:worksiteId` | View a worksite and its tasks | Both |
| `POST /worksites/:worksiteId/tasks` | Add a task with an assignee | Site supervisor |
| `PUT /tasks/:taskId/assignee` | Reassign a task | Site supervisor |
| `PUT /worksites/:worksiteId/reports/:workDate` | UC-1: create or update the caller's draft | Foreman |
| `GET /reports/:reportId` | View a report and its history | Both |
| `POST /reports/:reportId/submit` | UC-2 | Foreman |
| `POST /reports/:reportId/approve` | UC-3 | Site supervisor |
| `POST /reports/:reportId/reject` | UC-4 | Site supervisor |
| `GET /health` | Liveness and database check | None |

### 5.3 Errors

Every error has the same shape. Domain errors are mapped to HTTP statuses in one place, `error-handler.ts`.

```json
{ "error": { "code": "REPORT_VERSION_CONFLICT", "message": "The report has changed. Reload and try again.", "details": { "currentVersion": 4 } } }
```

| Status | When | Example rules |
| --- | --- | --- |
| `400` | Request fails schema validation | |
| `401` | Actor headers missing or invalid | |
| `403` | Actor is not allowed to perform the action | BR-6, BR-12, BR-13 |
| `404` | Resource does not exist | |
| `409` | Stale version, or the current status does not allow the action | BR-10, BR-15 |
| `422` | A business rule is violated, or a request key is reused with different content | BR-2 to BR-5, BR-7, BR-8, BR-14 |

## 6. Persistence

### 6.1 Tables

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `users` | Seeded users with a role | |
| `worksites` | Worksite, supervisor, status | |
| `tasks` | Task, assignee, `approved_progress` | `CHECK (approved_progress BETWEEN 0 AND 100)` |
| `daily_reports` | Report header, status, `version` | `UNIQUE (worksite_id, author_id, work_date)` for BR-1 |
| `report_items` | Reported progress per task | `UNIQUE (report_id, task_id)` for BR-4 |
| `report_transitions` | History of status changes for BR-11 | Append-only |
| `idempotency_keys` | Stored responses for BR-14 | `UNIQUE (actor_id, key)` |

The database enforces uniqueness. Application code never does check-then-insert.

### 6.2 Optimistic locking (BR-15)

Every write to a report is a conditional update on `version`. Zero rows updated means the caller's copy is stale.

### 6.3 Atomic approval (BR-5, BR-9, BR-15)

```ts
await prisma.$transaction(async (tx) => {
  const report = await tx.dailyReport.updateMany({
    where: { id, version: expectedVersion, status: "SUBMITTED" },
    data: { status: "APPROVED", version: { increment: 1 } },
  });
  if (report.count === 0) throw new ConflictError("REPORT_VERSION_CONFLICT");

  for (const item of items) {
    const task = await tx.task.updateMany({
      where: { id: item.taskId, approvedProgress: { lte: item.reportedProgress } },
      data: { approvedProgress: item.reportedProgress },
    });
    if (task.count === 0) throw new RuleViolationError("PROGRESS_BELOW_APPROVED", { taskId: item.taskId });
  }

  await tx.reportTransition.create({ data: transition });
});
```

Any throw rolls back the whole transaction, so the report stays `SUBMITTED` and no task changes.

### 6.4 Idempotency (BR-14)

`idempotency.middleware.ts` stores, per actor and key, a hash of the request and the response that was returned. A repeated key with the same hash replays the stored response. A repeated key with a different hash is rejected with `422`.

## 7. Request flow: approve a report

1. `actor.middleware.ts` reads the actor from the headers.
2. `idempotency.middleware.ts` looks up the request key and replays the stored response if there is one.
3. `report.routes.ts` validates the body with Zod and calls the `ApproveReport` use case.
4. `approve-report.ts` loads the report and its worksite, checks that the actor supervises the worksite (BR-12), and calls `report.approve()`.
5. `daily-report.ts` checks the state machine (BR-10) and records the transition.
6. `prisma-daily-report.repository.ts` writes the approval in one transaction (6.3).
7. `error-handler.ts` maps any domain error to the response in 5.3. On success the response is stored against the request key.

## 8. Configuration

Read once at startup in `config.ts`, validated with Zod, and exposed as a read-only object. The process exits if a value is missing or invalid.

| Variable | Meaning | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | none, required |
| `PORT` | HTTP port | `3000` |
| `BACKDATE_LIMIT_DAYS` | How many days back a report can be created (BR-2) | `5` |
| `APP_TIME_ZONE` | Time zone used to decide "today" (BR-2) | `Asia/Ho_Chi_Minh` |
| `LOG_LEVEL` | pino log level | `info` |

## 9. Deployment

The application runs with Docker Compose. One command starts everything: `docker compose up --build`.

| Service | Image | Role |
| --- | --- | --- |
| `db` | `postgres:17` | Database, with a named volume and a `pg_isready` healthcheck |
| `migrate` | Application image | Runs `prisma migrate deploy` and `prisma db seed` once, then exits. Starts after `db` is healthy |
| `api` | Application image | Runs the HTTP server. Starts after `migrate` completes successfully. Healthcheck on `GET /health` |

- The `Dockerfile` is multi-stage: a build stage compiles TypeScript and generates the Prisma client, and a runtime stage contains only production dependencies and the compiled output, running as a non-root user.
- Configuration comes from environment variables in `docker-compose.yml`. `.env.example` lists them. No secrets are committed.
- `main.ts` handles `SIGTERM`: it stops accepting connections, waits for in-flight requests, closes the Prisma client, and exits.

## 10. CI

One workflow on every push and pull request. All steps must pass.

1. `npm ci`, whose `postinstall` runs `prisma generate`
2. Typecheck: `tsc --noEmit`
3. Lint and format: `biome ci`
4. Architecture: `depcruise src`
5. Unit tests
6. Integration and API tests, with PostgreSQL from Testcontainers
7. `docker build`

`npm run check` runs steps 2 to 5 locally.
