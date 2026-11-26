import express, { type Express } from "express";
import { reportRoutes, type SaveDraft, type SubmitReport } from "./modules/reporting";
import { type GetWorksite, worksiteRoutes } from "./modules/worksite";
import type { UserRepository } from "./shared/domain/user.repository";
import { actorMiddleware } from "./shared/infrastructure/http/actor.middleware";
import { errorHandler, routeNotFound } from "./shared/infrastructure/http/error-handler";
import { healthRoutes } from "./shared/infrastructure/http/health.routes";
import {
  type IdempotencyKeyRepository,
  idempotencyMiddleware,
} from "./shared/infrastructure/http/idempotency.middleware";
import { requestLogMiddleware } from "./shared/infrastructure/http/request-log.middleware";
import type { Logger } from "./shared/infrastructure/logger";

export interface AppDependencies {
  readonly logger: Logger;
  readonly checkDatabase: () => Promise<void>;
  readonly users: UserRepository;
  readonly idempotencyKeys: IdempotencyKeyRepository;
  readonly getWorksite: GetWorksite;
  readonly saveDraft: SaveDraft;
  readonly submitReport: SubmitReport;
}

/** Builds the Express app without listening, so tests can drive it with supertest. */
export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestLogMiddleware(dependencies.logger));
  app.use(express.json());

  app.use(healthRoutes(dependencies.checkDatabase, dependencies.logger));

  // Every route below needs the caller's identity.
  app.use(actorMiddleware(dependencies.users));
  // BR-14: every POST and PUT carries a request key (API-02).
  app.use(idempotencyMiddleware(dependencies.idempotencyKeys));

  app.use(worksiteRoutes(dependencies.getWorksite));
  app.use(reportRoutes({ saveDraft: dependencies.saveDraft, submitReport: dependencies.submitReport }));

  app.use(routeNotFound());
  app.use(errorHandler(dependencies.logger));
  return app;
}
