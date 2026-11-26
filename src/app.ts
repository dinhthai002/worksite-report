import express, { type Express } from "express";
import {
  type ApproveReport,
  type GetReport,
  type RejectReport,
  reportOpenApi,
  reportRoutes,
  type SaveDraft,
  type SubmitReport,
} from "./modules/reporting";
import { type GetWorksite, worksiteOpenApi, worksiteRoutes } from "./modules/worksite";
import type { UserRepository } from "./shared/domain/user.repository";
import { actorMiddleware } from "./shared/infrastructure/http/actor.middleware";
import { docsRoutes } from "./shared/infrastructure/http/docs.routes";
import { errorHandler, routeNotFound } from "./shared/infrastructure/http/error-handler";
import { healthRoutes } from "./shared/infrastructure/http/health.routes";
import {
  type IdempotencyKeyRepository,
  idempotencyMiddleware,
} from "./shared/infrastructure/http/idempotency.middleware";
import { buildOpenApiDocument } from "./shared/infrastructure/http/openapi";
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
  readonly getReport: GetReport;
  readonly approveReport: ApproveReport;
  readonly rejectReport: RejectReport;
}

/** Builds the Express app without listening, so tests can drive it with supertest. */
export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestLogMiddleware(dependencies.logger));
  app.use(express.json());

  app.use(healthRoutes(dependencies.checkDatabase, dependencies.logger));
  // GET /openapi.json and the Swagger UI at /docs, readable without identity (API-05).
  app.use(docsRoutes(buildOpenApiDocument([worksiteOpenApi, reportOpenApi])));

  // Every route below needs the caller's identity.
  app.use(actorMiddleware(dependencies.users));
  // BR-14: every POST and PUT carries a request key (API-02).
  app.use(idempotencyMiddleware(dependencies.idempotencyKeys));

  app.use(worksiteRoutes(dependencies.getWorksite));
  app.use(
    reportRoutes({
      saveDraft: dependencies.saveDraft,
      submitReport: dependencies.submitReport,
      getReport: dependencies.getReport,
      approveReport: dependencies.approveReport,
      rejectReport: dependencies.rejectReport,
    }),
  );

  app.use(routeNotFound());
  app.use(errorHandler(dependencies.logger));
  return app;
}
