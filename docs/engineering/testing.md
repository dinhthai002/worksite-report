# Testing

- Scope: automated tests in this repository.
- Related documents: [Use cases and business rules](../product/use-cases.md), [Architecture](./architecture.md), [Coding standard](./coding-standard.md).
- Levels **MUST** and **SHOULD** have the same meaning as in the coding standard. Rules are coded `TST-xx`.

## 1. Test layers

| Layer | What it checks | Scope | Database | Location |
| --- | --- | --- | --- | --- |
| Unit | Business rules, state transitions, use case orchestration | One class or function | No. Ports are replaced by in-memory fakes | `test/unit/**/*.test.ts`, mirroring `src/` |
| Integration | Queries, mapping, constraints, transactions, optimistic locking | One repository | Real PostgreSQL in Testcontainers | `test/integration/*.int.test.ts` |
| API | HTTP contract, roles, validation, idempotency, full flows | The whole app through `supertest` | Real PostgreSQL in Testcontainers | `test/api/*.api.test.ts` |

### 1.1 Which change needs which tests

| Change | Unit | Integration | API |
| --- | --- | --- | --- |
| Rule in an aggregate or value object | MUST | | |
| New or changed use case | MUST | | SHOULD |
| Repository, mapper, migration | | MUST | |
| New or changed endpoint | | | MUST |
| Middleware | MUST | | MUST |
| Bug fix | MUST: a test that fails before the fix, at the lowest layer that reproduces it | | |

## 2. Rules

| Code | Rule | Level |
| --- | --- | --- |
| TST-01 | Every business rule BR-1 to BR-15 has at least one test, and the test name starts with the rule ID | MUST |
| TST-02 | Test names state behavior, not implementation: `BR-5 rejects reported progress below approved progress` | MUST |
| TST-03 | Tests follow arrange, act, assert, with one behavior per test | MUST |
| TST-04 | Unit tests do not touch the database, the network, the file system, or the real clock | MUST |
| TST-05 | Time is controlled with a `FixedClock`. No test depends on the current date | MUST |
| TST-06 | Fakes implement the same port as the real adapter and live in `test/fakes/`. No mocking library for ports | MUST |
| TST-07 | Integration and API tests run against real PostgreSQL. No SQLite, no mocked Prisma client | MUST |
| TST-08 | Each integration or API test starts from a clean database: tables are truncated before each test | MUST |
| TST-09 | Tests are independent and pass in any order | MUST |
| TST-10 | Test data is built with builders that have valid defaults: `aReport().submitted().build()` | SHOULD |
| TST-11 | State transitions are covered with a table-driven test over every pair of statuses | MUST |
| TST-12 | A flaky test is fixed or deleted. No retries, no `skip` on the main branch | MUST |
| TST-13 | A unit test's path mirrors the file it tests: `src/a/b.ts` is tested in `test/unit/a/b.test.ts`. When a file moves or is renamed, its test moves in the same commit. Tests import production code as `@src/...` | MUST |

## 3. Unit tests

### 3.1 Domain

Aggregates and value objects are tested directly, with no fakes.

```ts
describe("DailyReport", () => {
  it("BR-7 rejects submitting a report with no items", () => {
    const report = aReport().withNoItems().build();

    expect(() => report.submit(foreman, clock.now())).toThrow(RuleViolationError);
  });
});
```

The state machine is table-driven (TST-11): for each of the 16 pairs of statuses, the test asserts that the transition is either allowed or throws.

### 3.2 Application

Use cases are tested with in-memory fakes for repositories and a `FixedClock`.

```ts
it("BR-12 rejects approval by a supervisor of another worksite", async () => {
  const reports = new InMemoryDailyReportRepository([aReport().submitted().build()]);
  const approve = new ApproveReport(reports, worksites, clock);

  await expect(approve.execute({ reportId, actor: otherSupervisor, expectedVersion: 1 }))
    .rejects.toThrow(ForbiddenError);
});
```

## 4. Integration tests

They prove what a fake cannot: that the database enforces the rule.

| Test | Rule | What it proves |
| --- | --- | --- |
| Two inserts for the same foreman, worksite, and work date | BR-1 | The unique constraint rejects the second insert |
| Save with a stale `version` | BR-15 | Zero rows are updated and a conflict error is raised |
| Approval where one task's progress is already higher | BR-5, BR-9 | The transaction rolls back. The report stays `SUBMITTED` and no task changes |
| Approve and reject started at the same time | BR-15 | Exactly one succeeds |
| Mapper round trip | | A saved aggregate loads back equal to the original |

Concurrency tests start both operations with `Promise.allSettled` and assert on the pair of outcomes, not on which one won.

## 5. API tests

Each endpoint is checked for:

- the success response, including `version`
- validation failure: `400`
- missing or wrong role: `401`, `403`
- the business rule failures listed for its use case: `409`, `422`
- a repeated request with the same `Idempotency-Key`: same response, no new row (BR-14)

One scenario file per use case flow:

| File | Scenario |
| --- | --- |
| `report-flow.api.test.ts` | UC-1 to UC-4 in sequence: draft, submit, reject, edit, resubmit, approve, then check task progress |
| `idempotency.api.test.ts` | Five identical requests yield one report and five identical responses. Same key with a different body is rejected |
| `concurrency.api.test.ts` | Two saves from the same version: one succeeds, one receives `409` |
| `permissions.api.test.ts` | A foreman cannot approve. A foreman cannot report on another foreman's task. A supervisor of another worksite cannot approve |

## 6. Tooling

- **Jest** with ts-jest and three projects in `jest.config.js`: `unit`, `integration`, `api`. Unit tests run in parallel. Integration and API tests run with `--runInBand` against one shared container.
- **Testcontainers** starts `postgres:17.11` once per run in `test/setup.ts` (Jest `globalSetup`), applies migrations with `prisma migrate deploy`, and exposes `DATABASE_URL` to the tests through `process.env`. `test/teardown.ts` stops the container.
- **supertest** calls the Express app built by `app.ts`, with no network port.
- **`@src/` alias** for tests only: `tsconfig.json` `paths` and the Jest `moduleNameMapper` resolve it. Production code under `src/` uses relative imports; Biome rejects `@src/` there, and `tsconfig.build.json` clears `paths`.

| Script | Runs |
| --- | --- |
| `npm test` | Unit tests |
| `npm run test:int` | Integration tests |
| `npm run test:api` | API tests |
| `npm run test:all` | All three |
| `npm run test:cov` | Unit tests with coverage |

## 7. Coverage

- `domain` and `application`: at least 90% of lines and branches, enforced in `jest.config.js`.
- `infrastructure` and `interface`: no threshold. They are covered by integration and API tests.
- Coverage is a floor, not a goal. TST-01 matters more than the percentage.
