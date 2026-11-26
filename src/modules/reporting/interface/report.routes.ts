import { Router } from "express";
import { toTaskId, toWorksiteId } from "../../../shared/domain/ids";
import { currentActor } from "../../../shared/infrastructure/http/actor.middleware";
import { withValidInput } from "../../../shared/infrastructure/http/validate-input.middleware";
import type { ApproveReport } from "../application/approve-report";
import type { GetReport } from "../application/get-report";
import type { SaveDraft } from "../application/save-draft";
import type { SubmitReport } from "../application/submit-report";
import { toReportId, toWorkDate } from "../domain/daily-report";
import { approveReportBody, reportParams, saveDraftBody, saveDraftParams, submitReportBody } from "./report.schemas";

export interface ReportUseCases {
  readonly saveDraft: SaveDraft;
  readonly submitReport: SubmitReport;
  readonly getReport: GetReport;
  readonly approveReport: ApproveReport;
}

/** Daily report endpoints. Handlers parse, call one use case, and map the result (ARC-07). */
export function reportRoutes(useCases: ReportUseCases): Router {
  const router = Router();

  router.put(
    "/worksites/:worksiteId/reports/:workDate",
    withValidInput({ params: saveDraftParams, body: saveDraftBody }, async ({ params, body }, res): Promise<void> => {
      const result = await useCases.saveDraft.execute({
        actor: currentActor(res),
        worksiteId: toWorksiteId(params.worksiteId),
        workDate: toWorkDate(params.workDate),
        ...(body.version === undefined ? {} : { expectedVersion: body.version }),
        note: body.note ?? null,
        items: body.items.map((item) => ({
          taskId: toTaskId(item.taskId),
          reportedProgress: item.reportedProgress,
          note: item.note ?? null,
        })),
      });
      res.status(result.created ? 201 : 200).json(result.report);
    }),
  );

  router.post(
    "/reports/:reportId/submit",
    withValidInput({ params: reportParams, body: submitReportBody }, async ({ params, body }, res): Promise<void> => {
      const report = await useCases.submitReport.execute({
        actor: currentActor(res),
        reportId: toReportId(params.reportId),
        expectedVersion: body.version,
      });
      res.status(200).json(report);
    }),
  );

  router.post(
    "/reports/:reportId/approve",
    withValidInput({ params: reportParams, body: approveReportBody }, async ({ params, body }, res): Promise<void> => {
      const report = await useCases.approveReport.execute({
        actor: currentActor(res),
        reportId: toReportId(params.reportId),
        expectedVersion: body.version,
      });
      res.status(200).json(report);
    }),
  );

  router.get(
    "/reports/:reportId",
    withValidInput({ params: reportParams }, async ({ params }, res): Promise<void> => {
      const report = await useCases.getReport.execute({
        actor: currentActor(res),
        reportId: toReportId(params.reportId),
      });
      res.status(200).json(report);
    }),
  );

  return router;
}
