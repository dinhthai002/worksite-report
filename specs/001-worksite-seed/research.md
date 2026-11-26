# Research: Worksite seed and identity check

Phase 0 of [plan.md](./plan.md). The Technical Context has no open unknowns: the stack is fixed by
architecture.md section 2. This file records the design decisions the spec leaves to planning, each
with its rationale and the alternatives rejected.

## R1. Where the user lookup lives

- **Decision**: a `UserRepository` port in `src/shared/domain/user.repository.ts` with one method,
  `findRoleById(id: UserId): Promise<Role | undefined>`. `PrismaUserRepository` in
  `src/shared/infrastructure/prisma-user.repository.ts` implements it. The actor middleware
  receives the port through `createApp`.
- **Rationale**: the actor check runs for every module, so it belongs in `shared`. `shared` must
  not import `modules` (ARC-04), so the users table cannot be owned by `worksite`. A port keeps the
  middleware unit-testable with an in-memory fake (TST-06).
- **Alternatives rejected**: a `users` module (no use case owns users until a later feature; an
  extra module for one query); reading Prisma directly in the middleware (untestable without a
  database, and the middleware would bypass the port pattern every other read follows).

## R2. One refusal for every identity failure

- **Decision**: every identity failure throws `UnauthenticatedError` with code `UNAUTHENTICATED`
  and one fixed message: "Send X-Actor-Id as the UUID of a known user and X-Actor-Role as that
  user's role: FOREMAN or SITE_SUPERVISOR." The error carries a `reason`, a literal union
  `HEADERS_MISSING | HEADERS_MALFORMED | UNKNOWN_USER | ROLE_MISMATCH` (TS-05). `error-handler.ts`
  logs the reason at `warn` with the request ID and never puts it in the response.
- **Rationale**: FR-005 requires the unknown-user and role-mismatch refusals to be identical. Using
  the same message for missing and malformed headers too costs nothing and leaves nothing to
  compare. FR-005a requires the reason for operators. The log is the operator channel (LOG-01).
- **Alternatives rejected**: the current message for missing or malformed headers plus a second one
  for lookup failures (two messages to keep consistent, for no gain); the reason in `details`
  (reveals whether the identifier exists).

## R3. Creation and last-changed times

- **Decision**: every table has `created_at timestamptz(6) NOT NULL DEFAULT now()` and
  `updated_at timestamptz(6) NOT NULL DEFAULT now()`. One trigger function, `set_updated_at()`,
  runs `BEFORE UPDATE` on each table and sets `NEW.updated_at = now()`. `schema.prisma` declares
  both columns with `@default(now())` and does **not** use `@updatedAt`.
- **Rationale**: FR-015a says the last-changed time is updated on every change, whatever path writes
  it. Prisma's `@updatedAt` is set by the client, so a raw SQL update would skip it. A trigger
  makes the database guarantee it (constitution VI). `now()` is the transaction start time, so rows
  written in one transaction share a timestamp; FR-010 settles such ties.
- **Alternatives rejected**: `@updatedAt` alone (client-side only); setting times through `Clock`
  in use cases (every write path would have to remember it, and the seed has no `Clock`).
- **Note**: the times are written by the database, not read by `domain` or `application`, so ARC-10
  does not apply. Later features add the same two columns and the same trigger to each new table.

## R4. Task order

- **Decision**: `PrismaWorksiteRepository` loads tasks with
  `ORDER BY updated_at DESC, created_at ASC, id ASC`. The `Worksite` aggregate keeps the order it is
  given, and `GetWorksite` keeps it. The timestamps are not part of the domain model.
- **Rationale**: ordering is a query concern, and the database is the only place that holds the
  timestamps. Keeping them out of the domain avoids a field no rule uses. The order is proven by an
  integration test and by API scenario US1-7.
- **Alternatives rejected**: timestamps on `Task` and sorting in `domain` (a field that exists only
  for sorting; the in-memory fake would need fake times); sorting in the route (business-visible
  behavior in `interface`, ARC-07).

## R5. Which tasks a Foreman sees

- **Decision**: `Worksite.tasksVisibleTo(actor: Actor): readonly Task[]`. A `SITE_SUPERVISOR` gets
  every task; a `FOREMAN` gets the tasks where `task.isAssignedTo(actor.id)`. A `switch` over
  `Role` ends with `assertNever` (TS-06). `Task` lives in its own file, `task.ts`: it is an entity
  with its own identity, and it owns the question "is this task assigned to this user", which
  BR-4 reuses in feature 002. `WorksiteId` and `WorksiteStatus` stay in `worksite.ts`, and `TaskId`
  in `task.ts`, so the domain is three files with no import cycle.
- **Rationale**: FR-008a is a domain rule about the aggregate's data, so it lives in `domain`, once
  (ARC-05). It is not a business rule with a BR ID, so it cites FR-008a in its comment.
- **Alternatives rejected**: filtering in the repository query (puts a rule in `infrastructure`, and
  the unit test would need a database); filtering in `GetWorksite` (the rule would not be reusable
  by feature 002, which needs "tasks assigned to the author" for BR-4).

## R6. The seed: two modes, one script

- **Decision**: `prisma/seed.ts` exports the example data (`EXAMPLE`) and
  `loadExample(client, mode)`, with `mode` a literal union `"fill" | "reset"`. When run as a
  script, the mode is `reset` if the arguments include `--reset`, otherwise `fill`.
  - `fill`: one transaction of `createMany({ skipDuplicates: true })` for users, then worksites,
    then tasks. That is `INSERT ... ON CONFLICT DO NOTHING`, so an existing row is not touched and
    its `updated_at` does not change (FR-018a).
  - `reset`: one transaction of `upsert` by fixed ID for each example row. It sets the PRD values
    and leaves `created_at` alone. The trigger updates `updated_at` (FR-018b).
  - Startup runs `fill`: the compose `migrate` service runs
    `prisma migrate deploy && node dist/prisma/seed.js`.
  - The explicit command runs `reset`: `package.json` sets `"prisma": { "seed": "tsx prisma/seed.ts
    --reset" }`, so `npx prisma db seed` resets. `npx prisma migrate reset` also runs it, on an
    empty database.
  - `tsconfig.build.json` adds `prisma/seed.ts` to `include`, so the build emits
    `dist/prisma/seed.js` for the runtime image, which has no `tsx`.
- **Rationale**: the clarified spec needs a safe start and a deliberate reset. One script with a
  mode keeps the example data in one place. `skipDuplicates` and `upsert` use the primary key, so
  rows that are not part of the example are never touched (FR-018).
- **Alternatives rejected**: two scripts (two copies of the example data); `prisma.config.ts` for
  the seed command (Prisma 6 stops loading `.env` automatically once that file exists, which would
  change `prisma migrate dev` for every developer; that migration belongs with Prisma 7); running
  `tsx` in the runtime image (adds a dev dependency to production).
- **Known effect**: Prisma 6.19 prints a deprecation warning for `package.json#prisma`. It is
  harmless until Prisma 7.
- **Logging**: the script logs with the shared pino logger (LOG-01), never `console.log`.

## R7. Fixed identifiers

- **Decision**: readable RFC 9562 version-4 UUIDs:

  | Row | ID |
  | --- | --- |
  | Linda (SITE_SUPERVISOR) | `00000000-0000-4000-8000-000000000001` |
  | Mark (FOREMAN) | `00000000-0000-4000-8000-000000000002` |
  | Henry (FOREMAN) | `00000000-0000-4000-8000-000000000003` |
  | Three-storey townhouse | `00000000-0000-4000-8000-000000000101` |
  | Pour foundation | `00000000-0000-4000-8000-000000000201` |
  | Build ground-floor walls | `00000000-0000-4000-8000-000000000202` |
  | Install electrical | `00000000-0000-4000-8000-000000000203` |

- **Rationale**: the version nibble `4` and variant nibble `8` pass `z.uuid()`, which checks both.
  `fill` writes the three tasks in one transaction, so they share both timestamps, and the
  `id ASC` tie-break lists them in the PRD order, as the spec's ordering assumption requires.
- **Alternatives rejected**: random UUIDs (unreadable in the walkthrough); the nil-prefixed
  `...-0000-...-0001` without version and variant nibbles (rejected by `z.uuid()`).

## R8. Enumerations in the database

- **Decision**: PostgreSQL enums `user_role (FOREMAN, SITE_SUPERVISOR)` and
  `worksite_status (ACTIVE, CLOSED)`, declared as Prisma enums `UserRole` and `WorksiteStatus` with
  `@@map`.
- **Rationale**: the database refuses any other value (DB-02), and the values match the glossary.
- **Alternatives rejected**: `text` with a `CHECK` (the same guarantee, but Prisma types the column
  as `string`, and the mapper would need its own narrowing).

## R9. `Role` as a const object

- **Decision**: `src/shared/domain/actor.ts`, where `Role` already lives, exports
  `Role = { FOREMAN: "FOREMAN", SITE_SUPERVISOR: "SITE_SUPERVISOR" } as const` and the type
  `Role = (typeof Role)[keyof typeof Role]`, in place of the current string array. `ROLES` and
  `isRole` stay, so existing callers keep working. No new file.
- **Rationale**: implementation plan, section 3, and the glossary's `Role.FOREMAN`.

## R10. Approved progress in the domain

- **Decision**: `Task.approvedProgress` is a plain `number` in this feature. The database `CHECK`
  guards the range (FR-015). The `Progress` value object arrives in feature 002, as the
  implementation plan schedules, and replaces the number then.
- **Rationale**: nothing in this feature writes progress through the domain, so a value object
  would validate nothing.

## R11. Repository port

- **Decision**: `WorksiteRepository` has one method, `findById(id: WorksiteId): Promise<Worksite |
  undefined>`. No `save` until a feature writes worksites (005).
- **Rationale**: constitution X. The integration "round trip" test writes rows through a test helper
  and checks that `findById` loads them back equal to the expected aggregate.

## R12. Truncation between tests (TST-08)

- **Decision**: `test/support/database.ts` exports `truncateAll(client)`. It runs one tagged
  `$queryRaw` statement: a `DO` block that truncates every table in the current schema except
  `_prisma_migrations`, with `CASCADE`. It has no interpolated values. Raw inserts in tests use
  tagged `$queryRaw` too.
- **Rationale**: later features add tables without touching the helper. DB-06 allows raw SQL only
  through tagged `$queryRaw`. A `DO` block returns no rows, which `$queryRaw` accepts.
- **Alternatives rejected**: a hard-coded table list (every feature must remember to extend it);
  `$executeRawUnsafe` (DB-06); `$executeRaw` (DB-06 names only `$queryRaw`; allowing it needs a
  coding-standard amendment).

## R13. HTTP shape

- **Decision**: `GET /worksites/:worksiteId` returns the view object at the top level, with no
  envelope. A `worksiteId` that is not a UUID fails the Zod params schema and returns
  `400 VALIDATION_FAILED` with the issue in `details.issues`. An unknown ID returns
  `404 WORKSITE_NOT_FOUND` with `details.worksiteId`. See [contracts/](./contracts/).
- **Rationale**: matches the existing `/health` body and the error handler. The actor middleware
  runs before the route, so an unknown caller gets `401` before any lookup (spec, Edge Cases,
  "Order of checks").

## R14. Wiring

- **Decision**: `main.ts` builds `PrismaUserRepository`, `PrismaWorksiteRepository` and
  `GetWorksite`, and passes `users` and `getWorksite` to `createApp`. `worksite/index.ts` exports
  `worksiteRoutes`, `GetWorksite`, `PrismaWorksiteRepository`, and the domain types feature 002
  reads. API tests build the app the same way in `test/support/test-app.ts`.
- **Rationale**: ARC-09 (wiring by hand in `main.ts`) and ARC-03 (only `index.ts` is imported from
  outside the module).

## R15. Input validation in one shared middleware

- **Decision**: `src/shared/infrastructure/http/validate-input.middleware.ts` exports
  `withValidInput(schemas, handler)`. `schemas` has optional `params`, `query` and `body` Zod
  schemas. The middleware parses `{ params, query, body }` with one combined schema and calls
  `handler(input, res, req)` with the parsed, typed values. On failure it passes the `ZodError` to
  the error handler, which returns `400 VALIDATION_FAILED` with issue paths such as
  `params.worksiteId`, or `query` for an unknown query parameter, whose message names the key.
  - An omitted `params` or `query` schema means "none allowed": `z.strictObject({})`, so an
    unknown query parameter is refused.
  - An omitted `body` schema means "no body": `undefined` (no body sent) or `{}` (an empty JSON
    body) is accepted, and anything else is refused.
  - Each route declares its schemas in its `*.schemas.ts` file (NAM-05). The route handler
    receives typed input and still only calls one use case and maps the result (ARC-07).
- **Rationale**: API-01 requires body, path and query validation on every route. One shared
  implementation keeps the rule and the error shape identical everywhere, and the strict default
  means a route cannot forget its query or body.
- **Alternatives rejected**: a plain `app.use` middleware that writes the parsed values back to
  `req` (Express 5 defines `req.query` as a getter, so assigning it throws); storing them in
  `res.locals` (one global type for every route, so handlers lose the input types and would need
  casts, which TS-03 forbids); `schema.parse` inside every handler (repeated in every route, and a
  route can silently skip the query).
