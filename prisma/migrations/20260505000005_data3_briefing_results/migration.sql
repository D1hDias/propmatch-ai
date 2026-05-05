-- DATA-3 (Sprint 4): briefing_results
-- Links a briefing to the set of deduplicated, ranked properties returned.
-- Ticket: DATA-3 | Depends on: DATA-2
--
-- One row per (briefing, property) pair. Tracks fit_score, selection state,
-- and broker personal notes for WhatsApp message generation (Sprint 6).

CREATE TABLE briefing_results (
  briefing_id     UUID NOT NULL REFERENCES briefings (id) ON DELETE CASCADE,
  property_id     UUID NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
  fit_score       SMALLINT NOT NULL CHECK (fit_score BETWEEN 0 AND 100),
  score_breakdown JSONB,                    -- per-field breakdown for transparency
  rank            SMALLINT NOT NULL,        -- 1-based rank within the briefing
  selected        BOOLEAN NOT NULL DEFAULT FALSE,
  personal_note   TEXT,
  auto_widen_used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (briefing_id, property_id)
);

CREATE INDEX idx_briefing_results_briefing_id ON briefing_results (briefing_id, rank);
CREATE INDEX idx_briefing_results_selected    ON briefing_results (briefing_id, selected)
  WHERE selected = TRUE;

-- RLS: broker can see/update their own briefing results only
ALTER TABLE briefing_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "briefing_results_owner" ON briefing_results
  FOR ALL USING (
    briefing_id IN (
      SELECT id FROM briefings WHERE user_id = current_app_user()
    )
  );
