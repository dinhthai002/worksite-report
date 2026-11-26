# Worksite Report

A backend for tracking construction progress through daily reports. Foremen report progress on the tasks assigned to them. The site supervisor reviews each report, and task progress changes only when a report is approved.

The interesting parts are three guarantees:

- **Safe retries.** A request repeated after a network failure never creates a duplicate report.
- **No silent overwrites.** A write based on a stale copy of a report is rejected.
- **Atomic approval.** Approving a report updates every task in it, or changes nothing.

## Run it

Requires Docker.

```bash
docker compose up --build
curl http://localhost:3000/health
```

This starts PostgreSQL, applies migrations, loads the example data, and starts the API on port 3000. To walk through the main flow by hand, open `http/report-flow.http` in an editor with an HTTP client. It lists the user and worksite IDs to send.

The example data is the townhouse from the PRD: Linda (site supervisor), Mark and Henry (foremen), and the "Three-storey townhouse" worksite with three tasks. Every start adds only the example rows that are missing and keeps existing data, so progress you change survives a restart. To put the example back to its PRD values, run `npx prisma db seed`, or `docker compose run --rm migrate node dist/prisma/seed.js --reset` without Node.js on the host.

Reports are not part of the example data, and the walkthrough creates Mark's report for 20 November. To repeat the walkthrough from scratch, remove the data first with `docker compose down -v`, then start again.

## Develop

Requires Node.js 22 (see `.nvmrc`) and Docker (for the test database).

```bash
npm ci
cp .env.example .env
docker compose up -d db
npx prisma migrate dev
npm run dev
```

If another PostgreSQL already uses port 5432, set `DB_PORT` in `.env` (for example `55432`) and use the same port in `DATABASE_URL`.

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the API with reload |
| `npm run check` | Typecheck, lint, architecture rules, unit tests |
| `npm run test:all` | Unit, integration, and API tests |
| `npm run build` | Compile to `dist/` |

## Stack

Node.js, TypeScript, Express 5, Prisma, PostgreSQL, Zod, Jest, Testcontainers, Biome, Docker Compose.

## Structure

A modular monolith with two modules, each split into four layers.

```
src/
├── modules/
│   ├── worksite/      domain · application · infrastructure · interface
│   └── reporting/     domain · application · infrastructure · interface
└── shared/            actor, clock, errors, database client, HTTP middleware
```

`domain` is plain TypeScript with no framework or database imports. Dependency rules are checked in CI.

## Documentation

| Question | Document |
| --- | --- |
| What does it do? | [PRD](docs/product/prd.md), [Use cases and business rules](docs/product/use-cases.md) |
| What do the terms mean? | [Glossary](docs/glossary.md) |
| How is it built? | [Architecture](docs/engineering/architecture.md), [Coding standard](docs/engineering/coding-standard.md), [Testing](docs/engineering/testing.md) |
| How is work done? | [Workflow](docs/engineering/workflow.md) |
| In what order is it built? | [Implementation plan](docs/engineering/implementation-plan.md) |
| Why this way? | [ADRs](docs/adr/) |

## Simplifications

This model is deliberately smaller than a real construction workflow.

- Progress is a single percentage per task. Real reports record quantities, labor, weather, materials, and photos.
- Approving a daily report makes progress official. On a real site, quantities are usually confirmed through a separate inspection.
- There are two roles. Real sites also involve owners, consultants, subcontractors, and project managers.
- Approved progress never decreases. Rework would need a separate, explicit adjustment.
- There is no authentication. The caller's identity is supplied in request headers.
