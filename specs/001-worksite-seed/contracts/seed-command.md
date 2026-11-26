# Contract: loading the example data

The seed is a command-line interface (spec US3; FR-016 to FR-019).

| Invocation | Mode | Where |
| --- | --- | --- |
| `node dist/prisma/seed.js` | `fill` | Compose `migrate` service, after `prisma migrate deploy`, on every `docker compose up` |
| `npx prisma db seed` | `reset` | A developer's machine, against `DATABASE_URL` from `.env`. Runs `tsx prisma/seed.ts --reset` |
| `npx prisma migrate reset` | `reset` | Drops and recreates the database, then runs the seed |
| `docker compose run --rm migrate node dist/prisma/seed.js --reset` | `reset` | Against the Compose database, without Node.js on the host |

| Mode | Behavior |
| --- | --- |
| `fill` | Inserts the example rows that are missing. Changes no existing row, including its `updated_at` |
| `reset` | Sets every example row to the PRD values and inserts missing ones. `updated_at` advances; `created_at` does not change |

Both modes run in one transaction, touch only rows with the example's fixed IDs
([data-model.md](../data-model.md), section 4), and leave exactly one copy of each.

| Exit code | Meaning |
| --- | --- |
| `0` | Example loaded; one `info` log line with the mode and row counts |
| `1` | Failure; one `error` log line. In Compose, `api` does not start, because it waits for `migrate` to complete successfully |
