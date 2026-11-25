import { Router } from "express";
import type { Logger } from "../logger";
import type { ErrorBody } from "./error-handler";

/** GET /health: liveness and database check (architecture.md section 4). Needs no actor. */
export function healthRoutes(checkDatabase: () => Promise<void>, logger: Logger): Router {
  const router = Router();

  router.get("/health", async (_req, res): Promise<void> => {
    try {
      await checkDatabase();
      res.status(200).json({ status: "ok" });
    } catch (error) {
      logger.warn({ err: error }, "health check failed: database unreachable");
      const body: ErrorBody = { error: { code: "DATABASE_UNAVAILABLE", message: "The database is unreachable." } };
      res.status(503).json(body);
    }
  });

  return router;
}
