-- AUTH-2: refresh_tokens table for JWT session management
-- Stores hashed refresh tokens; rotated on every use, revoked on logout.

CREATE TABLE "refresh_tokens" (
  "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
  "token_hash"  VARCHAR(64) NOT NULL,
  "user_id"     UUID        NOT NULL,
  "expires_at"  TIMESTAMPTZ NOT NULL,
  "revoked_at"  TIMESTAMPTZ,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refresh_tokens_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "refresh_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "refresh_tokens_user_id_idx"  ON "refresh_tokens"("user_id");
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
