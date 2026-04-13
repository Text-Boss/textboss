-- Busy blocks: non-bookable time ranges that subtract from availability.
-- Populated via ICS import, AI natural language, or manual entry.
-- These are NOT appointments — they have no client, no booking context.
CREATE TABLE IF NOT EXISTS busy_blocks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email  text        NOT NULL,
  block_date   date        NOT NULL,
  start_time   text        NOT NULL,   -- "HH:MM" 24-hour
  end_time     text        NOT NULL,   -- "HH:MM" 24-hour
  label        text,                   -- "Dentist", "School pickup", event summary
  source       text        NOT NULL DEFAULT 'manual'
               CHECK (source IN ('ical_import', 'ai_parsed', 'manual')),
  import_batch uuid,                   -- groups rows from one ICS upload (for undo)
  expires_at   date,                   -- auto-cleanup placeholder (NULL = permanent)
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_busy_blocks_owner_date
  ON busy_blocks (owner_email, block_date);

CREATE INDEX IF NOT EXISTS idx_busy_blocks_batch
  ON busy_blocks (import_batch)
  WHERE import_batch IS NOT NULL;
