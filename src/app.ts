import express, { type Express } from "express";
import { type GetWorksite, worksiteRoutes } from "./modules/worksite";
import { actorMiddleware } from "./shared/infrastructure/http/actor.middleware";
import { errorHandler, routeNotFound } from "./shared/infrastructure/http/error-handler";
import { healthRoutes } from "./shared/infrastructure/http/health.routes";
import { requestLogMiddleware } from "./shared/infrastructure/http/request-log.middleware";
import type { Logger } from "./shared/infrastructure/logger";

export interface AppDependencies {
  readonly logger: Logger;
  readonly checkDatabase: () => Promise<void>;
  readonly getWorksite: GetWorksite;
}

/** Builds the Express app without listening, so tests can drive it with supertest. */
export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestLogMiddleware(dependencies.logger));
  app.use(express.json());

  app.use(healthRoutes(dependencies.checkDatabase, dependencies.logger));

  // Every route below needs the caller's identity.
  app.use(actorMiddleware());

  app.use(worksiteRoutes(dependencies.getWorksite));

  app.use(routeNotFound());
  app.use(errorHandler(dependencies.logger));
  return app;
}
