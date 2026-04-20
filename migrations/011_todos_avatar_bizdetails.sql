-- 011: Todos table + avatar + business detail fields on business_profiles

-- ── Business details (for prompt auto-fill) ──────────────────────────────────
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS avatar_data       text,
  ADD COLUMN IF NOT EXISTS business_name     text,
  ADD COLUMN IF NOT EXISTS owner_first_name  text,
  ADD COLUMN IF NOT EXISTS owner_full_name   text,
  ADD COLUMN IF NOT EXISTS business_phone    text,
  ADD COLUMN IF NOT EXISTS website           text,
  ADD COLUMN IF NOT EXISTS abn               text,
  ADD COLUMN IF NOT EXISTS city              text;

-- ── To-Do List ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS todos (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email  text        NOT NULL,
  text         text        NOT NULL CHECK (char_length(trim(text)) > 0 AND char_length(text) <= 2000),
  is_done      boolean     NOT NULL DEFAULT false,
  is_urgent    boolean     NOT NULL DEFAULT false,
  reminder_at  timestamptz,
  reminder_sent boolean    NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS todos_owner_email_idx ON todos (lower(owner_email));
CREATE INDEX IF NOT EXISTS todos_reminder_idx    ON todos (reminder_at)
  WHERE reminder_at IS NOT NULL AND reminder_sent = false AND is_done = false;
