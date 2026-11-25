# Coding Standard

- Scope: all source code in this repository (`src/`, `prisma/`, `test/`).
- Related documents: [Architecture](./architecture.md), [Testing](./testing.md).

## 0. How to read this document

- **MUST**: mandatory. A violation fails CI or is rejected in review.
- **SHOULD**: recommended. Deviations need a stated reason.

Each rule has a code for citing in reviews. The **Check** column names what enforces it: `tsc`, `biome`, `depcruise`, or `review` when it cannot be automated.

## 1. TypeScript (TS)

| Code | Rule | Level | Check |
| --- | --- | --- | --- |
| TS-01 | Enable `strict`, `noUncheckedIndexedAccess`, and `noImplicitOverride` | MUST | `tsc` |
| TS-02 | No `any`. Use `unknown` and narrow | MUST | `tsc`, `biome` |
| TS-03 | No `@ts-ignore`, no non-null assertion `!`, no `as unknown as T` | MUST | `biome` |
| TS-04 | Exported functions and methods declare a return type | MUST | `biome` |
| TS-05 | Finite sets of values are literal unions, not free-form strings | MUST | `review` |
| TS-06 | A `switch` over a union handles every case and ends with `assertNever` | MUST | `tsc` |
| TS-07 | Named exports only. No `export default` | MUST | `biome` |
| TS-08 | IDs are branded types (`WorksiteId`, `TaskId`, `ReportId`, `UserId`) in `domain` and `application` | SHOULD | `review` |

## 2. Naming (NAM)

| Code | Rule | Level | Check |
| --- | --- | --- | --- |
| NAM-01 | Files and directories are `kebab-case` | MUST | `biome` |
| NAM-02 | Classes and types are `PascalCase`. Functions and variables are `camelCase`. Constants are `UPPER_SNAKE_CASE` | MUST | `biome` |
| NAM-03 | Names of domain concepts come from the [glossary](../glossary.md), spelled exactly | MUST | `review` |
| NAM-04 | A use case file is named after the action: `approve-report.ts` exports `ApproveReport` | MUST | `review` |
| NAM-05 | File suffix states the role: `.repository.ts`, `.mapper.ts`, `.routes.ts`, `.schemas.ts`, `.middleware.ts`, `.test.ts` | MUST | `review` |
| NAM-06 | Database tables and columns are `snake_case`, mapped in `schema.prisma` | MUST | `review` |
| NAM-07 | Error codes are `UPPER_SNAKE_CASE` and stable: `REPORT_VERSION_CONFLICT` | MUST | `review` |

## 3. Architecture (ARC)

| Code | Rule | Level | Check |
| --- | --- | --- | --- |
| ARC-01 | `domain` imports only `domain` and `shared/domain` | MUST | `depcruise` |
| ARC-02 | `application` does not import `infrastructure` or `interface` | MUST | `depcruise` |
| ARC-03 | A module is imported only through its `index.ts` | MUST | `depcruise` |
| ARC-04 | `worksite` does not import `reporting`. `shared` does not import `modules` | MUST | `depcruise` |
| ARC-05 | Business rules live in `domain`. A rule is implemented once and cites its ID in a comment or test name | MUST | `review` |
| ARC-06 | One use case per file, one public `execute` method | MUST | `review` |
| ARC-07 | Route handlers only parse input, call one use case, and map the result. No business logic | MUST | `review` |
| ARC-08 | Prisma types do not leave `infrastructure`. Mappers convert rows to domain objects | MUST | `depcruise`, `review` |
| ARC-09 | Dependencies are passed through constructors and wired in `main.ts`. No module-level singletons except the logger | MUST | `review` |
| ARC-10 | The current time is read through `Clock`, never `new Date()` in `domain` or `application` | MUST | `biome`, `review` |

## 4. Error handling (ERR)

| Code | Rule | Level | Check |
| --- | --- | --- | --- |
| ERR-01 | `domain` and `application` throw subclasses of `DomainError` with an error code. They do not know HTTP statuses | MUST | `review` |
| ERR-02 | Domain errors are mapped to HTTP responses in `error-handler.ts` only | MUST | `review` |
| ERR-03 | No empty `catch`. A caught error is handled, rethrown, or logged with context | MUST | `biome` |
| ERR-04 | Prisma errors are translated at the repository: `P2002` becomes a domain conflict error | MUST | `review` |
| ERR-05 | Unknown errors return `500` with a generic message. Details go to the log, not the response | MUST | `review` |

## 5. Database and Prisma (DB)

| Code | Rule | Level | Check |
| --- | --- | --- | --- |
| DB-01 | `@prisma/client` is imported only in `infrastructure` and `shared/infrastructure` | MUST | `depcruise` |
| DB-02 | Uniqueness is enforced by a database constraint. No check-then-insert | MUST | `review` |
| DB-03 | Every write to a report is conditional on `version` and increments it | MUST | `review` |
| DB-04 | A use case that changes more than one row uses a single `$transaction` | MUST | `review` |
| DB-05 | Schema changes go through `prisma migrate dev`. Committed migrations are never edited | MUST | `review` |
| DB-06 | Raw SQL is allowed only through `$queryRaw` with tagged templates | MUST | `review` |

## 6. API and HTTP (API)

| Code | Rule | Level | Check |
| --- | --- | --- | --- |
| API-01 | Every request body, path, and query is validated with a Zod schema before the use case is called | MUST | `review` |
| API-02 | Every `POST` and `PUT` requires an `Idempotency-Key` header | MUST | `review` |
| API-03 | Every error response uses the shape defined in the architecture document | MUST | `review` |
| API-04 | Responses for reports always include the current `version` | MUST | `review` |

## 7. Logging and configuration (LOG, CFG)

| Code | Rule | Level | Check |
| --- | --- | --- | --- |
| LOG-01 | Use the shared pino logger. No `console.log` | MUST | `biome` |
| LOG-02 | Each request logs one line with method, path, status, duration, actor ID, and request ID | MUST | `review` |
| CFG-01 | `process.env` is read only in `config.ts`, and in `test/`, where Jest's global setup passes `DATABASE_URL` to the tests | MUST | `biome`, `review` |
| CFG-02 | No secrets or real connection strings in the repository | MUST | `review` |

## 8. Comments (DOC)

| Code | Rule | Level | Check |
| --- | --- | --- | --- |
| DOC-01 | Comments explain why, not what. Code that needs a what-comment is renamed or split | SHOULD | `review` |
| DOC-02 | Code that implements a business rule cites it: `// BR-5` | MUST | `review` |
| DOC-03 | No commented-out code, no `TODO` without an owner | MUST | `review` |

## 9. Git (GIT)

| Code | Rule | Level | Check |
| --- | --- | --- | --- |
| GIT-01 | Commit messages follow Conventional Commits: `feat(reporting): approve report` | MUST | `review` |
| GIT-02 | One logical change per commit. The build and tests pass at every commit | MUST | CI |
| GIT-03 | A commit that changes behavior includes its tests | MUST | `review` |

## 10. Mandatory checks

`npm run check` runs typecheck, Biome, dependency-cruiser, and unit tests. CI runs the same steps plus integration tests, API tests, and the Docker build. See the architecture document, section 10.
