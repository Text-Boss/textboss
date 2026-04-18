-- 008: Password authentication
-- Adds password_hash to entitlements and creates reset token table.

ALTER TABLE entitlements
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token       TEXT        PRIMARY KEY,
  email       TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prt_email
  ON password_reset_tokens (email);
