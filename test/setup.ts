import { execFileSync } from "node:child_process";
import path from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { currentTestDatabase, POSTGRES_IMAGE, setTestDatabase } from "./test-database";

/**
 * Jest globalSetup for the integration and api projects (testing.md section 6).
 * Starts one PostgreSQL container per run, applies migrations, and exposes DATABASE_URL to the tests.
 * When both projects run in one Jest invocation, the second setup reuses the first container.
 */

const PRISMA_CLI = path.resolve(__dirname, "..", "node_modules", "prisma", "build", "index.js");

async function globalSetup(): Promise<void> {
  const existing = currentTestDatabase();
  if (existing !== undefined) {
    existing.users += 1;
    return;
  }

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("site_daily_report_test").start();
  const databaseUrl = container.getConnectionUri();

  execFileSync(process.execPath, [PRISMA_CLI, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  process.env.DATABASE_URL = databaseUrl;
  setTestDatabase({ container, users: 1 });
}

export = globalSetup;
