import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";

/**
 * State shared by test/setup.ts and test/teardown.ts. Jest runs both in the parent process, so globalThis is
 * shared between them; this lets the integration and api projects reuse one container in a single run.
 */
export interface TestDatabase {
  readonly container: StartedPostgreSqlContainer;
  users: number;
}

export const POSTGRES_IMAGE = "postgres:17.11";

const state = globalThis as typeof globalThis & { worksiteReportTestDatabase?: TestDatabase };

export function currentTestDatabase(): TestDatabase | undefined {
  return state.worksiteReportTestDatabase;
}

export function setTestDatabase(database: TestDatabase | undefined): void {
  state.worksiteReportTestDatabase = database;
}
