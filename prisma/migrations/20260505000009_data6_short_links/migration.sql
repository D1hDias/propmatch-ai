-- DATA-6 (Sprint 6): short_links
-- Property URL shortener for WhatsApp messages.
-- Ticket: MSG-3 | Depends on: DATA-6 (messages)

CREATE TABLE short_links (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug        VARCHAR(10) NOT NULL,
  target_url  TEXT        NOT NULL,
  message_id  UUID        REFERENCES messages (id) ON DELETE SET NULL,
  clicks      INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_short_links_slug ON short_links (slug);
CREATE INDEX idx_short_links_message_id ON short_links (message_id);
