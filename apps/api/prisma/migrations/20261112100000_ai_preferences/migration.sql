-- Per-user choice of AI model: the server's free local model, or a hosted provider paid
-- with the user's own API key (encrypted with AES-256-GCM by the API; never stored in plain).
CREATE TYPE "AiMode" AS ENUM ('LOCAL', 'HOSTED');

CREATE TABLE "ai_preferences" (
    "user_id"            UUID NOT NULL,
    "mode"               "AiMode" NOT NULL DEFAULT 'LOCAL',
    "provider"           TEXT,
    "model"              TEXT,
    "api_key_ciphertext" TEXT,
    "api_key_hint"       TEXT,
    "updated_at"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_preferences_pkey" PRIMARY KEY ("user_id"),
    -- HOSTED requires a complete configuration.
    CONSTRAINT "ai_preferences_hosted_complete_check" CHECK (
      "mode" = 'LOCAL'
      OR ("provider" IS NOT NULL AND "model" IS NOT NULL AND "api_key_ciphertext" IS NOT NULL)
    )
);

ALTER TABLE "ai_preferences"
  ADD CONSTRAINT "ai_preferences_user_id_fkey" FOREIGN KEY ("user_id")
  REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
