import { z } from "zod";

/** GET /worksites/:worksiteId. No query and no body (contracts/get-worksite.md). */
export const getWorksiteParams = z.object({ worksiteId: z.uuid() });
