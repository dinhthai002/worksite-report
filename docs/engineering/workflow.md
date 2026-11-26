# Workflow

- Scope: how a change goes from requirement to merged code in this repository, using Spec-Kit with an AI coding agent.
- Related documents: [PRD](../product/prd.md), [Use cases and business rules](../product/use-cases.md), [Architecture](./architecture.md), [Coding standard](./coding-standard.md), [Testing](./testing.md).

## 1. Principles

1. **The documents come first.** Behavior is defined in `docs/product/` before any code is written. Code that disagrees with the documents is a bug in one of them, and the disagreement is resolved explicitly.
2. **The human decides, the agent drafts.** Specs, plans, and code may be drafted by an agent. Every artifact is read and approved by a person before the next step starts.
3. **Checks are automated.** `npm run check` and CI are the final safeguard. A step is done when its gate passes, not when the agent says so.

## 2. Order of precedence

When two sources disagree, the one higher in this list wins, and the lower one is corrected.

1. `docs/product/use-cases.md` (business rules)
2. `docs/product/prd.md`
3. `docs/glossary.md`
4. `docs/adr/`
5. `docs/engineering/architecture.md`
6. `docs/engineering/coding-standard.md` and `docs/engineering/testing.md`
7. `specs/` (per-feature spec, plan, tasks)

## 3. Steps for one feature

| # | Step | Command | Output | Gate |
| --- | --- | --- | --- | --- |
| 1 | Specify | `/speckit-specify` | `specs/NNN-name/spec.md`: user scenarios and requirements, citing use case and rule IDs | No technology named in the spec |
| 2 | Clarify | `/speckit-clarify` | Spec with no open questions | No `[NEEDS CLARIFICATION]` markers left |
| 3 | Plan | `/speckit-plan` | `plan.md`, `data-model.md`, `contracts/` | Plan follows the architecture document and its dependency rules |
| 4 | Tasks | `/speckit-tasks` | `tasks.md`, ordered, each task citing the rules it implements | Every rule in the spec is covered by a task and a test |
| 5 | Analyze | `/speckit-analyze` | Consistency report across spec, plan, and tasks | No critical findings |
| 6 | Implement | `/speckit-implement` | Code and tests | `npm run check` passes after each task group |
| 7 | Verify | | Integration and API tests | `npm run test:all` passes |
| 8 | Commit | | Small commits, one logical change each | CI passes |

Within a task group the order is: domain and its unit tests, then the use case and its unit tests, then the repository and its integration tests, then the route and its API tests.

## 4. Repository layout for Spec-Kit

```
.specify/
└── memory/
    └── constitution.md     project principles, derived from section 1 and the coding standard
specs/
└── 001-worksite-seed/
    ├── spec.md
    ├── plan.md
    ├── data-model.md
    ├── contracts/
    └── tasks.md
AGENTS.md                   entry point for the agent: what to read, what not to do
CLAUDE.md                   one line, `@AGENTS.md`, so Claude Code loads the same file
```

## 5. Rules for the agent

These rules are written in `AGENTS.md`.

- Read `docs/glossary.md` and the relevant sections of `docs/product/` before writing a spec or code. Use glossary terms exactly.
- Do not resolve a conflict between a document and a request silently. State it and ask.
- Do not change files under `docs/product/` or `docs/adr/` as a side effect of implementing a task.
- Do not edit check configuration (`tsconfig.json`, `biome.json`, `.dependency-cruiser.cjs`, CI workflow) or add ignore comments to make a check pass.
- Do not weaken, skip, or delete a failing test. Fix the code, or raise the question.
- Do not edit a committed migration.
- Do not add a dependency without asking.
- Run `npm run check` before reporting a task as done, and report the actual result.

## 6. Definition of done

- The behavior matches the use cases and business rules it cites.
- Every rule touched has a test named with its rule ID.
- `npm run check` and `npm run test:all` pass locally, and CI passes.
- `docker compose up --build` starts the application and `GET /health` returns `200`.
- Documents affected by the change are updated in the same commit series.
