-- DATA-6 (Sprint 6): messages
-- WhatsApp messages generated from briefing results.
-- Ticket: DATA-6 | Depends on: DATA-4 (clients), DATA-3 (briefings)
--
-- OPS-7: phone_hash populated 90 days after sent_at; raw phone purged by cron.

CREATE TYPE message_delivery_method AS ENUM ('clipboard', 'whatsapp_api');
CREATE TYPE message_delivery_status AS ENUM ('pending', 'copied', 'sent', 'delivered', 'read', 'failed');

CREATE TABLE messages (
  id               UUID                    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  briefing_id      UUID                    NOT NULL REFERENCES briefings (id) ON DELETE CASCADE,
  client_id        UUID                    NOT NULL REFERENCES clients (id)   ON DELETE RESTRICT,
  formatted_text   TEXT                    NOT NULL,
  delivery_method  message_delivery_method NOT NULL DEFAULT 'clipboard',
  delivery_status  message_delivery_status NOT NULL DEFAULT 'pending',
  sent_at          TIMESTAMPTZ,
  -- OPS-7: raw phone replaced with sha256 hash 90d post-send
  phone_hash       VARCHAR(64),
  created_at       TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_briefing_id ON messages (briefing_id);
CREATE INDEX idx_messages_client_id   ON messages (client_id);
CREATE INDEX idx_messages_sent_at     ON messages (sent_at)
  WHERE sent_at IS NOT NULL AND phone_hash IS NULL;

-- RLS: broker can see only messages for their briefings
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_owner" ON messages
  FOR ALL USING (
    briefing_id IN (
      SELECT id FROM briefings WHERE user_id = current_app_user()
    )
  );
