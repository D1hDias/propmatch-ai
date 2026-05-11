-- INFRA-5: Postgres tuning — índices adicionais + autovacuum por tabela
-- Baseado nos query patterns observados no pilot.
-- Ticket: INFRA-5

-- ---------------------------------------------------------------------------
-- Extensões (devem vir antes dos índices que dependem delas)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Índices adicionais identificados pelo pilot
-- ---------------------------------------------------------------------------

-- briefings: busca por status (fila de extração/busca)
CREATE INDEX IF NOT EXISTS idx_briefings_status ON briefings (status)
  WHERE status IN ('extracting', 'searching');

-- briefings: HITL review queue
CREATE INDEX IF NOT EXISTS idx_briefings_review_status ON briefings (review_status, created_at DESC)
  WHERE review_status = 'pending';

-- clients: busca por nome (typeahead no ClientSelector)
CREATE INDEX IF NOT EXISTS idx_clients_name_trgm ON clients
  USING gin (name gin_trgm_ops);

-- short_links: cleanup de links antigos
CREATE INDEX IF NOT EXISTS idx_short_links_created_at ON short_links (created_at);

-- ---------------------------------------------------------------------------
-- Autovacuum agressivo nas tabelas de alta escrita
-- ---------------------------------------------------------------------------

ALTER TABLE briefings SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);

ALTER TABLE messages SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE audit_log SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
