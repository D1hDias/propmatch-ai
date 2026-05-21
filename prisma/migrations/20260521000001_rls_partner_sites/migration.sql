-- RLS-PARTNER-SITES: habilita Row Level Security na tabela partner_sites.
-- Ticket: backlog/rls-partner-sites
-- Motivo: tabela criada sem RLS nas migrações DATA-7; brokers poderiam ler
--         sites de outros brokers sem esta policy.

ALTER TABLE "partner_sites" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partner_sites_owner" ON "partner_sites"
  FOR ALL USING (user_id = current_app_user());
