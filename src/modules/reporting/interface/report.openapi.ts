import { z } from "zod";
import { jsonSchema, type OpenApiModule, operation, schemaRef } from "../../../shared/infrastructure/http/openapi";
import { ReportStatus } from "../domain/daily-report";
import {
  approveReportBody,
  rejectReportBody,
  reportParams,
  saveDraftBody,
  saveDraftParams,
  submitReportBody,
} from "./report.schemas";

const TAG = "Reports";

const reportStatus = z.enum([ReportStatus.DRAFT, ReportStatus.SUBMITTED, ReportStatus.REJECTED, ReportStatus.APPROVED]);

/** The report response of every report endpoint (002 contracts/report-view.md). API tests parse real responses with it. */
export const reportViewSchema = z.strictObject({
  id: z.uuid(),
  worksiteId: z.uuid(),
  authorId: z.uuid().meta({ description: "User ID of the foreman who wrote the report" }),
  workDate: z.iso.date(),
  status: reportStatus,
  version: z
    .number()
    .int()
    .min(1)
    .meta({ description: "Send it back with the next save, submission or decision (BR-15)" }),
  note: z.string().max(2000).nullable(),
  items: z
    .array(
      z.strictObject({
        taskId: z.uuid(),
        reportedProgress: z.number().int().min(0).max(100),
        note: z.string().max(2000).nullable(),
      }),
    )
    .meta({ description: "Last changed first (FR-032)" }),
  transitions: z
    .array(
      z.strictObject({
        fromStatus: reportStatus,
        toStatus: reportStatus,
        actorId: z.uuid(),
        occurredAt: z.iso.datetime().meta({ description: "ISO 8601, UTC" }),
        reason: z.string().nullable().meta({ description: "The rejection reason; null for other transitions" }),
      }),
    )
    .meta({ description: "Every status change, oldest first (BR-11)" }),
});

const REPORT_VIEW = "ReportView";

const NOT_FOUND = ["REPORT_NOT_FOUND", "no report has this ID"] as const;
const VERSION_CONFLICT = [
  "REPORT_VERSION_CONFLICT",
  "`version` is not the current one; reload the report (BR-15). `details` has `expectedVersion` and `currentVersion`",
] as const;

/** Example IDs from the PRD's townhouse (prisma/seed.ts). */
const WALLS = "00000000-0000-4000-8000-000000000202";

/** The reporting module's endpoints (API-05). */
export const reportOpenApi: OpenApiModule = {
  tag: { name: TAG, description: "Daily reports: draft, submit, approve, reject, view" },
  schemas: { [REPORT_VIEW]: jsonSchema(reportViewSchema, "output") },
  paths: {
    "/worksites/{worksiteId}/reports/{workDate}": {
      put: operation({
        operationId: "saveDraft",
        summary: "Save the caller's report for a worksite and work date (UC-1)",
        description:
          "Without `version`: creates the report, or returns the caller's existing one unchanged (BR-1). With `version`: replaces the note and the whole item list of a `DRAFT` or `REJECTED` report. Notes are at most 2,000 characters. Foremen only.",
        tag: TAG,
        params: saveDraftParams,
        body: {
          schema: saveDraftBody,
          example: {
            note: "Rain stopped work at 15:00.",
            items: [{ taskId: WALLS, reportedProgress: 55, note: null }],
          },
        },
        success: {
          "201": { description: "The report was created: `DRAFT`, version 1.", schema: schemaRef(REPORT_VIEW) },
          "200": {
            description:
              "The existing report, unchanged, when no `version` was sent (BR-1); otherwise the report as saved, with `version` increased.",
            schema: schemaRef(REPORT_VIEW),
          },
        },
        errors: {
          "403": [["ROLE_CANNOT_AUTHOR_REPORTS", "the caller is a site supervisor"]],
          "404": [["WORKSITE_NOT_FOUND", "no worksite has this ID"]],
          "409": [VERSION_CONFLICT, ["REPORT_NOT_EDITABLE", "the report is `SUBMITTED` or `APPROVED` (BR-6)"]],
          "422": [
            ["WORK_DATE_OUT_OF_RANGE", "the work date is in the future or before the backdating limit (BR-2)"],
            ["WORKSITE_CLOSED", "the worksite is `CLOSED` (BR-3)"],
            ["TASK_LISTED_TWICE", "a task appears twice (BR-4)"],
            ["TASK_NOT_IN_WORKSITE", "a task is not in this worksite (BR-4)"],
            ["TASK_NOT_ASSIGNED_TO_AUTHOR", "a task is assigned to another foreman (BR-4)"],
            ["PROGRESS_OUT_OF_RANGE", "reported progress is below 0 or above 100 (BR-5)"],
          ],
        },
      }),
    },
    "/reports/{reportId}": {
      get: operation({
        operationId: "getReport",
        summary: "View a report, its items and its history (UC-5)",
        description:
          "The author may view it in any status; the worksite's site supervisor once it is submitted; nobody else.",
        tag: TAG,
        params: reportParams,
        success: { "200": { description: "The report.", schema: schemaRef(REPORT_VIEW) } },
        errors: {
          "403": [["REPORT_VIEW_FORBIDDEN", "the caller may not view this report"]],
          "404": [NOT_FOUND],
        },
      }),
    },
    "/reports/{reportId}/submit": {
      post: operation({
        operationId: "submitReport",
        summary: "Submit a DRAFT or REJECTED report for review (UC-2)",
        description: "The author only. No task's approved progress changes.",
        tag: TAG,
        params: reportParams,
        body: { schema: submitReportBody, example: { version: 1 } },
        success: {
          "200": { description: "The report, `SUBMITTED`, with the new transition.", schema: schemaRef(REPORT_VIEW) },
        },
        errors: {
          "403": [
            ["ROLE_CANNOT_AUTHOR_REPORTS", "the caller is a site supervisor"],
            ["NOT_REPORT_AUTHOR", "the caller is not the report's author (BR-6)"],
          ],
          "404": [NOT_FOUND],
          "409": [VERSION_CONFLICT, ["INVALID_STATUS_TRANSITION", "the report is `SUBMITTED` or `APPROVED`"]],
          "422": [
            ["WORKSITE_CLOSED", "the worksite is `CLOSED` (BR-3)"],
            ["REPORT_HAS_NO_ITEMS", "the report has no items (BR-7)"],
            ["TASK_NOT_ASSIGNED_TO_AUTHOR", "a task was reassigned since the save (BR-4)"],
            ["PROGRESS_BELOW_APPROVED", "reported progress is below the task's approved progress (BR-5)"],
          ],
        },
      }),
    },
    "/reports/{reportId}/approve": {
      post: operation({
        operationId: "approveReport",
        summary: "Approve a SUBMITTED report (UC-3)",
        description:
          "The worksite's site supervisor only. Every task in the report gets its reported progress as approved progress, together or not at all (BR-9). Read the worksite to see the tasks.",
        tag: TAG,
        params: reportParams,
        body: { schema: approveReportBody, example: { version: 2 } },
        success: {
          "200": { description: "The report, `APPROVED`, with the new transition.", schema: schemaRef(REPORT_VIEW) },
        },
        errors: {
          "403": [
            [
              "REPORT_APPROVAL_FORBIDDEN",
              "the caller is not the worksite's site supervisor, or the report is a `DRAFT` (BR-12)",
            ],
          ],
          "404": [NOT_FOUND],
          "409": [VERSION_CONFLICT, ["INVALID_STATUS_TRANSITION", "the report is `APPROVED` or `REJECTED` (BR-10)"]],
          "422": [
            [
              "REPORT_PROGRESS_OUTDATED",
              "a task's approved progress is already above the report's figure (BR-5); `details.tasks` lists each one. Reject the report instead",
            ],
          ],
        },
      }),
    },
    "/reports/{reportId}/reject": {
      post: operation({
        operationId: "rejectReport",
        summary: "Reject a SUBMITTED report with a reason (UC-4)",
        description:
          "The worksite's site supervisor only. No task changes. The author can then edit the report and submit it again.",
        tag: TAG,
        params: reportParams,
        body: {
          schema: rejectReportBody,
          example: { version: 2, reason: "conduit laid, no wiring pulled yet" },
        },
        success: {
          "200": {
            description: "The report, `REJECTED`, with the new transition and its reason.",
            schema: schemaRef(REPORT_VIEW),
          },
        },
        errors: {
          "403": [
            [
              "REPORT_REJECTION_FORBIDDEN",
              "the caller is not the worksite's site supervisor, or the report is a `DRAFT` (BR-12)",
            ],
          ],
          "404": [NOT_FOUND],
          "409": [VERSION_CONFLICT, ["INVALID_STATUS_TRANSITION", "the report is `APPROVED` (BR-10) or `REJECTED`"]],
          "422": [["REJECTION_REASON_REQUIRED", "the reason is missing, empty or only whitespace (BR-8)"]],
        },
      }),
    },
  },
};
