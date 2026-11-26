-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('FOREMAN', 'SITE_SUPERVISOR');

-- CreateEnum
CREATE TYPE "worksite_status" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worksites" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "supervisor_id" UUID NOT NULL,
    "status" "worksite_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worksites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "worksite_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "assignee_id" UUID NOT NULL,
    "approved_progress" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "worksites_supervisor_id_idx" ON "worksites"("supervisor_id");

-- CreateIndex
CREATE INDEX "tasks_worksite_id_idx" ON "tasks"("worksite_id");

-- CreateIndex
CREATE INDEX "tasks_assignee_id_idx" ON "tasks"("assignee_id");

-- AddForeignKey
ALTER TABLE "worksites" ADD CONSTRAINT "worksites_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_worksite_id_fkey" FOREIGN KEY ("worksite_id") REFERENCES "worksites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (data-model.md section 2.4): constraints and triggers schema.prisma cannot express.

-- FR-015: approved progress is an integer from 0 to 100, whatever writes it.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_approved_progress_range" CHECK ("approved_progress" BETWEEN 0 AND 100);

-- FR-015a: updated_at changes on every update, whatever path writes the row.
CREATE FUNCTION "set_updated_at"() RETURNS TRIGGER AS $$
BEGIN
    NEW."updated_at" = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_set_updated_at" BEFORE UPDATE ON "users"
    FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();

CREATE TRIGGER "worksites_set_updated_at" BEFORE UPDATE ON "worksites"
    FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();

CREATE TRIGGER "tasks_set_updated_at" BEFORE UPDATE ON "tasks"
    FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
