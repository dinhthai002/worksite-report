# AGENTS.md

Instructions for AI coding agents working in this repository.

## Project

Worksite Report: a TypeScript backend (Express 5, Prisma, PostgreSQL) where foremen report task progress and a site supervisor approves it. A modular monolith with two modules, `worksite` and `reporting`, in four DDD layers.

## Read before you work

| When | Read |
| --- | --- |
| Always | `docs/glossary.md` |
| Writing a spec, or changing behavior | `docs/product/prd.md`, `docs/product/use-cases.md` |
| Writing or moving code | `docs/engineering/architecture.md`, `docs/engineering/coding-standard.md` |
| Writing tests | `docs/engineering/testing.md` |
| Starting a feature | `docs/engineering/workflow.md` |

Read only the sections you need for the current step.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run check` | Typecheck, lint, architecture rules, unit tests. Run before reporting a task as done |
| `npm run test:all` | Unit, integration, and API tests. Needs Docker |
| `npx prisma migrate dev --name <name>` | Create a migration after changing `schema.prisma` |
| `docker compose up --build` | Run the whole application |

## Rules that matter most

- `domain` imports only `domain` and `shared/domain`. No Express, Prisma, or Zod there.
- Import another module only through its `index.ts`. `worksite` never imports `reporting`.
- Business rules live in `domain`, are implemented once, and cite their ID: `// BR-5`.
- One use case per file in `application`. Route handlers contain no business logic.
- Every write to a report is conditional on `version`. A use case that changes more than one row uses one transaction.
- Read the time through `Clock`. Read configuration through `config.ts`.
- Use glossary terms exactly: `Worksite`, `Foreman`, `SiteSupervisor`, `DailyReport`, `approvedProgress`.
- Every business rule has a test whose name starts with the rule ID.

## Do not

- Do not resolve a conflict between a document and a request silently. State it and ask.
- Do not edit files under `docs/product/` or `docs/adr/` as a side effect of a coding task.
- Do not edit `tsconfig.json`, `biome.json`, `.dependency-cruiser.cjs`, or the CI workflow to make a check pass, and do not add ignore comments.
- Do not weaken, skip, or delete a failing test.
- Do not edit a committed migration.
- Do not add a dependency without asking.

## Done means

- The behavior matches the use cases and rules it cites.
- `npm run check` passes, and you report the actual output.
- New behavior has tests at the layer the testing guide requires.
