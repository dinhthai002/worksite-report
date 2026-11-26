import { createApp } from "./app";
import { type Config, loadConfig } from "./config";
import { ApproveReport, GetReport, PrismaDailyReportRepository, SaveDraft, SubmitReport } from "./modules/reporting";
import { GetWorksite, PrismaWorksiteRepository } from "./modules/worksite";
import { checkDatabase, createPrismaClient } from "./shared/infrastructure/db";
import { createLogger, type Logger } from "./shared/infrastructure/logger";
import { PrismaIdempotencyKeyRepository } from "./shared/infrastructure/prisma-idempotency-key.repository";
import { PrismaUserRepository } from "./shared/infrastructure/prisma-user.repository";
import { SystemClock } from "./shared/infrastructure/system-clock";

/** How long in-flight requests get to finish after SIGTERM before the process is forced to exit. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

function loadConfigOrExit(bootLogger: Logger): Config | undefined {
  try {
    return loadConfig();
  } catch (error) {
    bootLogger.fatal({ err: error }, "invalid configuration, exiting");
    process.exitCode = 1;
    return undefined;
  }
}

/** Wiring: every dependency is created here and passed down by hand (ARC-09). */
function main(): void {
  const config = loadConfigOrExit(createLogger("info"));
  if (config === undefined) {
    return;
  }
  const logger = createLogger(config.logLevel);
  const prisma = createPrismaClient(config.databaseUrl);
  const clock = new SystemClock(config.appTimeZone);
  const worksites = new PrismaWorksiteRepository(prisma);
  const reports = new PrismaDailyReportRepository(prisma);

  const app = createApp({
    logger,
    checkDatabase: () => checkDatabase(prisma),
    users: new PrismaUserRepository(prisma),
    idempotencyKeys: new PrismaIdempotencyKeyRepository(prisma),
    getWorksite: new GetWorksite(worksites),
    saveDraft: new SaveDraft(reports, worksites, clock, config.backdateLimitDays),
    submitReport: new SubmitReport(reports, worksites, clock),
    getReport: new GetReport(reports, worksites),
    approveReport: new ApproveReport(reports, worksites, clock),
  });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, "listening");
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, "shutting down: no new connections, waiting for in-flight requests");
    const forcedExit = setTimeout(() => {
      logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forcedExit.unref();

    server.close((closeError) => {
      if (closeError !== undefined) {
        logger.error({ err: closeError }, "error while closing the HTTP server");
        process.exitCode = 1;
      }
      prisma
        .$disconnect()
        .then(() => logger.info("shutdown complete"))
        .catch((disconnectError: unknown) => {
          logger.error({ err: disconnectError }, "error while disconnecting from the database");
          process.exitCode = 1;
        });
    });
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main();
