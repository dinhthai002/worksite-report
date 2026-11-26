import { z } from "zod";
import { jsonSchema, type OpenApiModule, operation, schemaRef } from "../../../shared/infrastructure/http/openapi";
import { WorksiteStatus } from "../domain/worksite";
import { getWorksiteParams } from "./worksite.schemas";

const TAG = "Worksites";
const WORKSITE_VIEW = "WorksiteView";

/** GetWorksite's WorksiteView (contracts/get-worksite.md). API tests parse real responses with it. */
export const worksiteViewSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  status: z.enum([WorksiteStatus.ACTIVE, WorksiteStatus.CLOSED]),
  supervisorId: z.uuid().meta({ description: "User ID of the worksite's site supervisor" }),
  tasks: z
    .array(
      z.strictObject({
        id: z.uuid(),
        name: z.string(),
        assigneeId: z.uuid().meta({ description: "User ID of the foreman the task is assigned to" }),
        approvedProgress: z.number().int().min(0).max(100),
      }),
    )
    .meta({
      description:
        "A site supervisor gets every task; a foreman only the tasks assigned to them. Last changed first (FR-010).",
    }),
});

/** The worksite module's endpoints (API-05). */
export const worksiteOpenApi: OpenApiModule = {
  tag: { name: TAG, description: "Worksites and their tasks" },
  schemas: { [WORKSITE_VIEW]: jsonSchema(worksiteViewSchema, "output") },
  paths: {
    "/worksites/{worksiteId}": {
      get: operation({
        operationId: "getWorksite",
        summary: "View a worksite and its tasks",
        description: "Any known user may view any worksite (PRD, Roles).",
        tag: TAG,
        params: getWorksiteParams,
        success: {
          "200": {
            description: "The worksite with the tasks the caller may see.",
            schema: schemaRef(WORKSITE_VIEW),
          },
        },
        errors: { "404": [["WORKSITE_NOT_FOUND", "no worksite has this ID"]] },
      }),
    },
  },
};
