import { Router } from "express";
import { currentActor } from "../../../shared/infrastructure/http/actor.middleware";
import { withValidInput } from "../../../shared/infrastructure/http/validate-input.middleware";
import type { GetWorksite } from "../application/get-worksite";
import { toWorksiteId } from "../domain/worksite";
import { getWorksiteParams } from "./worksite.schemas";

/** Worksite endpoints. Handlers parse, call one use case, and map the result (ARC-07). */
export function worksiteRoutes(getWorksite: GetWorksite): Router {
  const router = Router();

  router.get(
    "/worksites/:worksiteId",
    withValidInput({ params: getWorksiteParams }, async ({ params }, res): Promise<void> => {
      const view = await getWorksite.execute({
        worksiteId: toWorksiteId(params.worksiteId),
        actor: currentActor(res),
      });
      res.status(200).json(view);
    }),
  );

  return router;
}
