import { Router } from "express";
import { serve, setup } from "swagger-ui-express";
import type { OpenApiDocument } from "./openapi";

/**
 * GET /openapi.json and the Swagger UI at /docs (API-05). Mounted before the actor check, like GET /health: reading
 * the description needs no identity. Requests sent from the UI go through the normal checks.
 */
export function docsRoutes(document: OpenApiDocument): Router {
  const router = Router();

  router.get("/openapi.json", (_req, res): void => {
    res.status(200).json(document);
  });

  router.use(
    "/docs",
    serve,
    setup(document, {
      customSiteTitle: "Worksite Report API",
      // Keeps the actor headers set with Authorize across page reloads.
      swaggerOptions: { persistAuthorization: true },
    }),
  );

  return router;
}
