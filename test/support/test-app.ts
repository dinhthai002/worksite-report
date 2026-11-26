import { type AppDependencies, createApp } from "@src/app";
import { GetWorksite, PrismaWorksiteRepository } from "@src/modules/worksite";
import { checkDatabase, type DatabaseClient } from "@src/shared/infrastructure/db";
import { createLogger } from "@src/shared/infrastructure/logger";
import { PrismaUserRepository } from "@src/shared/infrastructure/prisma-user.repository";
import type { Express } from "express";

/**
 * Builds the app with the real adapters, wired the same way as main.ts (ARC-09), for API tests.
 * `overrides` replaces single dependencies, for example a failing database check or a recording logger.
 */
export function createTestApp(client: DatabaseClient, overrides: Partial<AppDependencies> = {}): Express {
  return createApp({
    logger: createLogger("silent"),
    checkDatabase: () => checkDatabase(client),
    users: new PrismaUserRepository(client),
    getWorksite: new GetWorksite(new PrismaWorksiteRepository(client)),
    ...overrides,
  });
}
