# Architecture

- Scope: how the Worksite Report backend is organized, built, and run. This document is general: it does not describe individual features.
- Related documents: [PRD](../product/prd.md), [Use cases and business rules](../product/use-cases.md), [Glossary](../glossary.md), [Coding standard](./coding-standard.md), [Testing](./testing.md), [Workflow](./workflow.md), [ADRs](../adr/).
- Feature design lives with each feature, produced by the Spec-Kit workflow (see [Workflow](./workflow.md)): `specs/NNN-name/` holds the spec, the domain and data model (`data-model.md`), and the HTTP contracts (`contracts/`).
- Code samples in this document illustrate the design. The source of truth is the code in `src/`.

## 1. Overview

A modular monolith following DDD tactical patterns: one codebase, one Docker image, one HTTP entrypoint. Each module groups one area of the domain and is split into four layers.

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

 shared/           domain: concepts used by every module (Actor, Clock, errors)
                   infrastructure: config, logger, database client, HTTP middleware
```

### 1.1 Dependency rules

Checked by `dependency-cruiser` in CI (coding standard, ARC-01 to ARC-04 and DB-01).

- `interface` → `application` → `domain`. `infrastructure` implements the ports declared in `domain`.
- `domain` imports nothing outside its own `domain` and `shared/domain`. No `express`, no `@prisma/client`, no `zod`.
- A module is imported only through its `index.ts`. Dependencies between modules go one way; the allowed direction is fixed in the coding standard (ARC-04).
- `shared` does not import `modules`.

### 1.2 What is deliberately left out

- No CQRS bus, no event sourcing, no domain events, no message queue.
- No dependency injection container. Dependencies are wired by hand in `main.ts`.
- No authentication. The caller's identity and role arrive in request headers (see 4.1).

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
worksite-report/
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
├── specs/                  one folder per feature, produced by Spec-Kit (workflow.md)
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
│
├── http/                   manual request walkthroughs for an HTTP client
│
├── src/
│   ├── main.ts             wiring, listen, graceful shutdown
│   ├── app.ts              builds the Express app, does not listen
│   ├── config.ts           typed, read-only configuration
│   │
│   ├── modules/
│   │   └── <module>/
│   │       ├── domain/           aggregates, entities, value objects, repository ports
│   │       ├── application/      one use case per file
│   │       ├── infrastructure/   Prisma repositories, mappers
│   │       ├── interface/        routes, Zod schemas
│   │       └── index.ts          the module's public API
│   │
│   └── shared/
│       ├── domain/               concepts used by every module: actor, clock, errors
│       └── infrastructure/       db.ts, system-clock.ts, logger.ts,
│                                 http/ (middleware, error-handler.ts, health.routes.ts)
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

File names inside a module follow the coding standard: a use case file is named after its action (NAM-04), and the suffix states the role (NAM-05).

## 4. HTTP API

Endpoints are defined per feature in `specs/NNN-name/contracts/`. The only endpoint that is not part of a feature is `GET /health`: a liveness and database check that needs no actor.

### 4.1 Conventions

| Topic | Convention |
| --- | --- |
| Identity | `X-Actor-Id` (UUID) and `X-Actor-Role` (a role from the glossary) headers. Missing or invalid: `401` |
| Safe retries | `Idempotency-Key` header, required on every `POST` and `PUT` (API-02) |
| Concurrency | A request that changes a versioned resource carries the `version` the client last read. Every response returns the current `version` (API-04) |
| Dates | Calendar dates as `YYYY-MM-DD` |
| Timestamps | ISO 8601 with offset |
| Field names | `camelCase` |

### 4.2 Errors

Every error has the same shape (API-03). Domain errors are mapped to HTTP statuses in one place, `error-handler.ts` (ERR-02).

```json
{ "error": { "code": "SOME_ERROR_CODE", "message": "What went wrong and how to fix it.", "details": { } } }
```

| Status | When |
| --- | --- |
| `400` | The request fails schema validation, or the body is not valid JSON |
| `401` | Actor headers missing or invalid |
| `403` | The actor is not allowed to perform the action (`ForbiddenError`) |
| `404` | The resource or route does not exist (`NotFoundError`) |
| `409` | A stale `version`, or the current state does not allow the action (`ConflictError`) |
| `422` | A business rule is violated, or a request key is reused with different content (`RuleViolationError`) |
| `500` | Any other error. The response is generic; details go to the log only (ERR-05) |

## 5. Persistence

The schema lives in `prisma/schema.prisma` and changes only through Prisma Migrate (DB-05). Each feature's tables and constraints are designed in its `data-model.md`.

### 5.1 Constraints, not checks

The database enforces uniqueness and value ranges. Application code never does check-then-insert (DB-02). Constraints that `schema.prisma` cannot express (CHECK constraints, triggers) are added to the generated migration SQL before it is committed.

### 5.2 Optimistic locking

A resource that users edit concurrently has an integer `version` column. Every write is a conditional update on the `version` the caller read, and increments it (DB-03). Zero rows updated means the caller's copy is stale and raises a `ConflictError`. See ADR 0003.

### 5.3 Transactions

A use case that changes more than one row does it in a single `$transaction` (DB-04). Any thrown error rolls back the whole transaction. A transaction that spans more than one aggregate is an exception recorded in an ADR (ADR 0004).

### 5.4 Idempotency

`idempotency.middleware.ts` stores, per actor and request key, a hash of the request and the response that was returned. A repeated key with the same hash replays the stored response. A repeated key with a different hash is rejected with `422`.

## 6. Request flow

Every request that changes state goes through the same path:

1. `request-log.middleware.ts` assigns a request ID and logs one line when the response finishes (LOG-02).
2. `actor.middleware.ts` reads the actor from the headers, or responds `401`.
3. `idempotency.middleware.ts` replays the stored response if the request key was already used.
4. The module's route validates the input with Zod and calls one use case (ARC-07).
5. The use case loads aggregates through repository ports, checks permissions, and calls methods on the aggregates, which enforce the business rules (ARC-05).
6. The repository writes the result, conditionally on `version` and in one transaction where needed.
7. `error-handler.ts` turns any error into the response shape in 4.2. On success, the response is stored against the request key.

## 7. Configuration

Read once at startup in `config.ts`, validated with Zod, and exposed as a read-only object. The process exits if a value is missing or invalid.

| Variable | Meaning | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | none, required |
| `PORT` | HTTP port | `3000` |
| `BACKDATE_LIMIT_DAYS` | How many days back a report can be created (BR-2) | `5` |
| `APP_TIME_ZONE` | Time zone used to decide "today" (BR-2) | `Asia/Ho_Chi_Minh` |
| `LOG_LEVEL` | pino log level | `info` |

`DB_PORT` is read only by Docker Compose, not by the application: it sets the host port of the `db` service.

## 8. Deployment

The application runs with Docker Compose. One command starts everything: `docker compose up --build`.

| Service | Image | Role |
| --- | --- | --- |
| `db` | `postgres:17` | Database, with a named volume and a `pg_isready` healthcheck |
| `migrate` | Application image | Runs `prisma migrate deploy`, and the seed once there is one, then exits. Starts after `db` is healthy |
| `api` | Application image | Runs the HTTP server. Starts after `migrate` completes successfully. Healthcheck on `GET /health` |

- The `Dockerfile` is multi-stage: a build stage compiles TypeScript and generates the Prisma client, and a runtime stage contains only production dependencies and the compiled output, running as a non-root user.
- Configuration comes from environment variables in `docker-compose.yml`. `.env.example` lists them. No secrets are committed.
- `main.ts` handles `SIGTERM`: it stops accepting connections, waits for in-flight requests, closes the Prisma client, and exits.

## 9. CI

One workflow on every push and pull request. All steps must pass.

1. `npm ci`, whose `postinstall` runs `prisma generate`
2. Typecheck: `tsc --noEmit`
3. Lint and format: `biome ci`
4. Architecture: `depcruise src`
5. Unit tests
6. Integration and API tests, with PostgreSQL from Testcontainers
7. `docker build`

`npm run check` runs steps 2 to 5 locally.
