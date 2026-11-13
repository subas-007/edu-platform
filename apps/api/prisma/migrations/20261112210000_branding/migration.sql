-- Site branding set by an administrator: name, logo and colour theme (one row).
-- CreateEnum
CREATE TYPE "SurfaceTheme" AS ENUM ('MIDNIGHT', 'GRAPHITE', 'PLUM', 'PINE', 'ESPRESSO');

-- CreateTable
CREATE TABLE "branding" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "app_name" TEXT NOT NULL,
    "accent_color" TEXT NOT NULL,
    "surface" "SurfaceTheme" NOT NULL DEFAULT 'MIDNIGHT',
    "logo" BYTEA,
    "logo_mime_type" TEXT,
    "logo_updated_at" TIMESTAMP(3),
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branding_pkey" PRIMARY KEY ("id"),
    -- A single row: the site has one look.
    CONSTRAINT "branding_single_row" CHECK ("id" = 1)
);

-- AddForeignKey
ALTER TABLE "branding" ADD CONSTRAINT "branding_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
