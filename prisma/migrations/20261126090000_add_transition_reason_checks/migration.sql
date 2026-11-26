-- FR-003: a transition's reason is at most 2,000 characters, as notes are.
ALTER TABLE "report_transitions" ADD CONSTRAINT "report_transitions_reason_length"
  CHECK (char_length("reason") <= 2000);

-- BR-8: a rejection has a reason with at least one non-space character.
ALTER TABLE "report_transitions" ADD CONSTRAINT "report_transitions_rejection_reason"
  CHECK ("to_status" <> 'REJECTED' OR ("reason" IS NOT NULL AND "reason" ~ '\S'));
