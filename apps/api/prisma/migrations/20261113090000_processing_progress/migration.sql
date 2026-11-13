-- Progress of a long processing step (OCR of scanned PDF pages), shown while a material is PROCESSING.
ALTER TABLE "materials" ADD COLUMN "processing_note" TEXT,
ADD COLUMN "processing_progress" INTEGER;
