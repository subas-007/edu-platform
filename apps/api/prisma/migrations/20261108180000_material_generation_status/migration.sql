-- Track flashcard/question/roadmap generation separately from ingestion (chunk + embed),
-- so the UI can show progress and a failed/interrupted generation can be retried.
CREATE TYPE "GenerationStatus" AS ENUM ('PENDING', 'GENERATING', 'COMPLETED', 'FAILED');

ALTER TABLE "materials"
  ADD COLUMN "generation_status"   "GenerationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "generation_progress" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "generation_error"    TEXT,
  ADD CONSTRAINT "materials_generation_progress_check"
    CHECK ("generation_progress" BETWEEN 0 AND 100);

-- Backfill: the roadmap is written last, so its presence means generation finished.
UPDATE "materials" m
   SET "generation_status" = 'COMPLETED', "generation_progress" = 100
 WHERE EXISTS (SELECT 1 FROM "study_roadmaps" r WHERE r."material_id" = m."id");
-- Everything else stays PENDING; the worker re-queues READY materials that never finished.
