-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED');

-- CreateTable
CREATE TABLE "daily_reports" (
    "id" UUID NOT NULL,
    "worksite_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "status" "report_status" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_items" (
    "report_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "reported_progress" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_items_pkey" PRIMARY KEY ("report_id","task_id")
);

-- CreateTable
CREATE TABLE "report_transitions" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "from_status" "report_status" NOT NULL,
    "to_status" "report_status" NOT NULL,
    "actor_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "actor_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("actor_id","key")
);

-- CreateIndex
CREATE INDEX "daily_reports_author_id_idx" ON "daily_reports"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_worksite_id_author_id_work_date_key" ON "daily_reports"("worksite_id", "author_id", "work_date");

-- CreateIndex
CREATE INDEX "report_items_task_id_idx" ON "report_items"("task_id");

-- CreateIndex
CREATE INDEX "report_transitions_report_id_occurred_at_idx" ON "report_transitions"("report_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_worksite_id_fkey" FOREIGN KEY ("worksite_id") REFERENCES "worksites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_items" ADD CONSTRAINT "report_items_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_items" ADD CONSTRAINT "report_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_transitions" ADD CONSTRAINT "report_transitions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_transitions" ADD CONSTRAINT "report_transitions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (specs/002-draft-and-submit/data-model.md section 2.6): constraints and triggers schema.prisma cannot
-- express.

-- BR-15: a report's version starts at 1 and only grows.
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_version_positive" CHECK ("version" >= 1);

-- FR-002a: notes are at most 2,000 characters.
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_note_length" CHECK (char_length("note") <= 2000);
ALTER TABLE "report_items" ADD CONSTRAINT "report_items_note_length" CHECK (char_length("note") <= 2000);

-- BR-5: reported progress is an integer from 0 to 100, whatever writes it.
ALTER TABLE "report_items" ADD CONSTRAINT "report_items_reported_progress_range" CHECK ("reported_progress" BETWEEN 0 AND 100);

-- BR-14: a request key is 1 to 255 characters, and a claim is either in progress (no response) or completed (all set).
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_key_length" CHECK (char_length("key") BETWEEN 1 AND 255);
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_completion" CHECK (
    ("response_status" IS NULL) = ("completed_at" IS NULL)
    AND ("response_body" IS NULL) = ("completed_at" IS NULL)
);

-- architecture.md 5.5: updated_at changes on every update, whatever path writes the row.
CREATE TRIGGER "daily_reports_set_updated_at" BEFORE UPDATE ON "daily_reports"
    FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();

CREATE TRIGGER "report_items_set_updated_at" BEFORE UPDATE ON "report_items"
    FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();

CREATE TRIGGER "report_transitions_set_updated_at" BEFORE UPDATE ON "report_transitions"
    FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();

CREATE TRIGGER "idempotency_keys_set_updated_at" BEFORE UPDATE ON "idempotency_keys"
    FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();

-- BR-11: a recorded transition is permanent. This trigger sorts before report_transitions_set_updated_at, so it
-- fires first and refuses every UPDATE and DELETE. TRUNCATE is not blocked, so tests can still empty the table.
CREATE FUNCTION "reject_report_transition_change"() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'report_transitions is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "report_transitions_append_only" BEFORE UPDATE OR DELETE ON "report_transitions"
    FOR EACH ROW EXECUTE FUNCTION "reject_report_transition_change"();
