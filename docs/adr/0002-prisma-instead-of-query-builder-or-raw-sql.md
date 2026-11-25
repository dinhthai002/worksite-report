# ADR 0002: Prisma instead of a query builder or raw SQL

- Status: Accepted
- Date: 2026-11-25

## Context

The data model is small: seven tables (architecture.md section 6.1). The hard parts are not complex queries but correctness under concurrency: unique constraints (BR-1, BR-4, BR-14), conditional updates on `version` (BR-15), and one transaction across reports and tasks (BR-9). Schema changes must be versioned and reviewable, and the team should get type-safe queries without writing types by hand.

## Decision

Use Prisma ORM 6 with Prisma Migrate.

- `prisma/schema.prisma` is the single description of the schema. Migrations are generated with `prisma migrate dev` and never edited after commit (DB-05).
- Constraints that the schema language cannot express (CHECK, triggers) are added to the generated migration SQL before it is committed.
- Conditional writes use `updateMany` with the expected `version` in `where`, and multi-row changes use `$transaction` (DB-03, DB-04).
- Raw SQL is allowed only through `$queryRaw` with tagged templates (DB-06).
- Prisma types stay in `infrastructure`. Mappers convert rows to domain objects (ARC-08, DB-01).

Prisma 6 rather than 7: version 7 requires a driver adapter package and a generated client inside the source tree. Version 6 keeps the classic `prisma-client-js` generator with no adapter, which is simpler for this size. Moving to 7 later touches only `shared/infrastructure/db.ts` and the generator block.

## Consequences

- Queries are typed from the schema, and migrations are plain SQL files that reviewers can read.
- Some constraints live in migration SQL rather than in `schema.prisma`, so the schema file alone does not show every rule. Integration tests prove each constraint against real PostgreSQL.
- The Prisma CLI is a runtime dependency, because the `migrate` service runs from the application image.

Alternatives rejected:

- **A query builder (Kysely, Knex).** Type-safe SQL, but migrations and row types become our own code to maintain.
- **Raw SQL with `pg`.** Full control, but every query and result type is hand-written, and mistakes surface only at runtime.
- **TypeORM or Drizzle.** TypeORM's entity classes tend to leak persistence concerns into the domain. Drizzle is a reasonable option, but has fewer people on the team who already know it.
