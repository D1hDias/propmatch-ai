-- S12: CRM completo — perfil detalhado, urgência, status de pipeline, threshold de match

CREATE TYPE "client_urgency"   AS ENUM ('ativo', 'prazo', 'explorando');
CREATE TYPE "client_crm_status" AS ENUM ('ativo', 'negociacao', 'fechado', 'pausado');

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "email"           TEXT,
  ADD COLUMN IF NOT EXISTS "crm_status"      "client_crm_status" NOT NULL DEFAULT 'ativo',
  ADD COLUMN IF NOT EXISTS "urgency"         "client_urgency"    NOT NULL DEFAULT 'explorando',
  ADD COLUMN IF NOT EXISTS "match_threshold" INTEGER             NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS "profile"         JSONB;

-- Indexes for CRM list views
CREATE INDEX IF NOT EXISTS "clients_user_crm_status_idx" ON "clients"("user_id", "crm_status");
CREATE INDEX IF NOT EXISTS "clients_user_urgency_idx"    ON "clients"("user_id", "urgency");
