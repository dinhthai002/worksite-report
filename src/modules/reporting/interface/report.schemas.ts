import { z } from "zod";

/** The longest note on a report or an item (FR-002a). The database guards the same limit. */
const NOTE_MAX_LENGTH = 2000;

const reportItemInput = z
  .strictObject({
    taskId: z.uuid(),
    // Only the type is checked here: the range 0 to 100 is BR-5, implemented once in the domain (ARC-05, research R5).
    reportedProgress: z.number().int(),
    note: z.string().nullable().optional(),
  })
  .superRefine((item, context) => {
    // FR-002a: the message names the task, which an array index in the issue path would not.
    if (item.note !== undefined && item.note !== null && item.note.length > NOTE_MAX_LENGTH) {
      context.addIssue({
        code: "custom",
        path: ["note"],
        message: `The note for task ${item.taskId} is longer than ${NOTE_MAX_LENGTH} characters.`,
      });
    }
  });

/** PUT /worksites/:worksiteId/reports/:workDate (contracts/save-draft.md). */
export const saveDraftParams = z.object({ worksiteId: z.uuid(), workDate: z.iso.date() });

export const saveDraftBody = z.strictObject({
  version: z.number().int().min(1).optional(),
  note: z
    .string()
    .max(NOTE_MAX_LENGTH, `The note must be at most ${NOTE_MAX_LENGTH} characters.`)
    .nullable()
    .optional(),
  items: z.array(reportItemInput),
});

/** A report addressed by its ID: POST /reports/:reportId/submit, GET /reports/:reportId. */
export const reportParams = z.object({ reportId: z.uuid() });

/** POST /reports/:reportId/submit (contracts/submit-report.md). The version is required (BR-15). */
export const submitReportBody = z.strictObject({ version: z.number().int().min(1) });

/**
 * POST /reports/:reportId/approve (contracts/approve-report.md). The version and nothing else: a reason or comment is
 * refused like any other unknown field (spec FR-015, Clarifications; research R6).
 */
export const approveReportBody = z.strictObject({ version: z.number().int().min(1) });

/** The longest rejection reason: the note limit (004 spec, Clarifications Q1). The database guards it too. */
const REASON_MAX_LENGTH = 2000;

/**
 * POST /reports/:reportId/reject (004 contracts/reject-report.md). A missing or null reason is BR-8, decided in the
 * domain after permission, version and status (004 Clarifications Q2); only the type and length are checked here.
 */
export const rejectReportBody = z.strictObject({
  version: z.number().int().min(1),
  reason: z
    .string()
    .max(REASON_MAX_LENGTH, `The reason must be at most ${REASON_MAX_LENGTH} characters.`)
    .nullable()
    .optional(),
});
