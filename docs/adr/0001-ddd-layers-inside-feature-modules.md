# ADR 0001: DDD layers inside feature modules

- Status: Accepted
- Date: 2026-11-25

## Context

The product has two clusters of behavior. Worksites and tasks change rarely and are owned by the site supervisor. Daily reports change many times a day, have a four-state lifecycle, and carry most of the business rules (BR-1 to BR-11, BR-14, BR-15). The rules must live in one place, be testable without a database, and stay readable as features are added by people and by an AI coding agent working from written specs.

## Decision

The code is a modular monolith with two modules, `worksite` and `reporting`. Each module has four layers: `domain`, `application`, `infrastructure`, `interface`.

- `domain` is plain TypeScript: aggregates, value objects, repository ports. It imports nothing but its own `domain` and `shared/domain`.
- `application` holds one use case per file and depends on ports, never on Prisma or Express.
- A module is used by others only through its `index.ts`. `reporting` may depend on `worksite`; never the reverse.
- Dependencies are wired by hand in `main.ts`. There is no DI container.

These rules are checked by dependency-cruiser in CI (ARC-01 to ARC-04, DB-01).

## Consequences

- Business rules are unit-tested in memory, with fakes for ports and a `FixedClock`.
- A change to one rule touches one module and usually one layer, which keeps specs and reviews small.
- There is more ceremony than a two-layer app: mappers between Prisma rows and aggregates, and ports for repositories.
- Cross-module writes need an explicit decision. Approval is the one case today (ADR 0004).

Alternatives rejected:

- **Layer-first folders** (`controllers/`, `services/`, `repositories/` across the whole app). A feature is spread over every folder, and nothing stops `worksite` code from reaching into `reporting` internals.
- **A framework with a DI container** (NestJS or similar). It solves wiring we do not have. Two modules and a handful of use cases are wired in a few lines of `main.ts`.
- **Separate services per module.** Approval must update a report and its tasks atomically (BR-9). Across services that would need a distributed transaction or a saga, for no scaling benefit at this size.
