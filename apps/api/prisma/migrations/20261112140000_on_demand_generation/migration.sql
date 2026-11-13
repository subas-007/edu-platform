-- Student uploads: flashcards / questions are generated on request (one row per material and kind).
-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('FLASHCARDS', 'QUESTIONS');

-- CreateEnum
CREATE TYPE "GenerationRequestMode" AS ENUM ('REPLACE', 'MORE');

-- CreateTable
CREATE TABLE "material_generations" (
    "material_id" UUID NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "status" "GenerationStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "engine" "AiMode" NOT NULL,
    "engine_label" TEXT NOT NULL,
    "mode" "GenerationRequestMode" NOT NULL,
    "requested_by" UUID NOT NULL,
    "added" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_generations_pkey" PRIMARY KEY ("material_id","kind")
);

-- CreateIndex
CREATE INDEX "material_generations_status_idx" ON "material_generations"("status");

-- AddForeignKey
ALTER TABLE "material_generations" ADD CONSTRAINT "material_generations_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_generations" ADD CONSTRAINT "material_generations_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

