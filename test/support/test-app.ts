import { type AppDependencies, createApp } from "@src/app";
import { DEFAULT_BACKDATE_LIMIT_DAYS } from "@src/config";
import { PrismaDailyReportRepository, SaveDraft, SubmitReport } from "@src/modules/reporting";
import { GetWorksite, PrismaWorksiteRepository } from "@src/modules/worksite";
import type { Clock } from "@src/shared/domain/clock";
import { checkDatabase, type DatabaseClient } from "@src/shared/infrastructure/db";
import { createLogger } from "@src/shared/infrastructure/logger";
import { PrismaUserRepository } from "@src/shared/infrastructure/prisma-user.repository";
import type { Express } from "express";
import { FixedClock } from "../fakes/fixed-clock";

/** 10:00 on 21 November 2026 in Asia/Ho_Chi_Minh: the PRD example's 20 November is yesterday. */
export const TEST_NOW = "2026-11-21T03:00:00Z";

export interface TestAppOptions {
  /** The clock the use cases read. Defaults to TEST_NOW in Asia/Ho_Chi_Minh. */
  readonly clock?: Clock;
}

/**
 * Builds the app with the real adapters, wired the same way as main.ts (ARC-09), for API tests.
 * The backdating limit is always the default, never read from the environment, so BR-2 is tested at the default
 * (FR-037a). `overrides` replaces single dependencies, for example a failing database check or a recording logger.
 */
export function createTestApp(
  client: DatabaseClient,
  overrides: Partial<AppDependencies> = {},
  options: TestAppOptions = {},
): Express {
  const clock = options.clock ?? new FixedClock(TEST_NOW);
  const worksites = new PrismaWorksiteRepository(client);
  const reports = new PrismaDailyReportRepository(client);
  return createApp({
    logger: createLogger("silent"),
    checkDatabase: () => checkDatabase(client),
    users: new PrismaUserRepository(client),
    getWorksite: new GetWorksite(worksites),
    saveDraft: new SaveDraft(reports, worksites, clock, DEFAULT_BACKDATE_LIMIT_DAYS),
    submitReport: new SubmitReport(reports, worksites, clock),
    ...overrides,
  });
}
