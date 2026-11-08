-- CreateEnum
CREATE TYPE "ExamPaperStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "full_name" TEXT;

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "content_hash" TEXT,
ADD COLUMN     "reused_from_id" UUID;

-- AlterTable
ALTER TABLE "exam_sessions" ADD COLUMN     "paper_id" UUID,
ALTER COLUMN "material_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "exam_papers" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "ExamPaperStatus" NOT NULL DEFAULT 'DRAFT',
    "duration_minutes" INTEGER NOT NULL,
    "max_attempts" INTEGER NOT NULL DEFAULT 1,
    "question_ids" UUID[],
    "material_ids" UUID[],
    "created_by" UUID NOT NULL,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_papers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_enrollments" (
    "id" UUID NOT NULL,
    "paper_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_papers_status_idx" ON "exam_papers"("status");

-- CreateIndex
CREATE INDEX "exam_enrollments_student_id_idx" ON "exam_enrollments"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_enrollments_paper_id_student_id_key" ON "exam_enrollments"("paper_id", "student_id");

-- CreateIndex
CREATE INDEX "materials_content_hash_idx" ON "materials"("content_hash");

-- CreateIndex
CREATE INDEX "exam_sessions_paper_id_idx" ON "exam_sessions"("paper_id");

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_reused_from_id_fkey" FOREIGN KEY ("reused_from_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "exam_papers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_enrollments" ADD CONSTRAINT "exam_enrollments_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "exam_papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_enrollments" ADD CONSTRAINT "exam_enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A session targets exactly one of: a material (practice) or an exam paper (program).
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_target_check"
  CHECK (("material_id" IS NOT NULL) <> ("paper_id" IS NOT NULL));
