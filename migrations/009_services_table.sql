-- 009: Relational services table + slot_duration_min on business_profiles

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS slot_duration_min integer NOT NULL DEFAULT 30
    CHECK (slot_duration_min > 0 AND slot_duration_min % 15 = 0);

CREATE TABLE IF NOT EXISTS services (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_email   text          NOT NULL,
  title            text          NOT NULL CHECK (char_length(trim(title)) > 0 AND char_length(title) <= 120),
  description      text          CHECK (char_length(description) <= 500),
  duration_min     integer       NOT NULL CHECK (duration_min > 0 AND duration_min % 15 = 0),
  price            numeric(10,2) CHECK (price >= 0),
  buffer_time_min  integer       NOT NULL DEFAULT 0 CHECK (buffer_time_min >= 0 AND buffer_time_min <= 240),
  is_active        boolean       NOT NULL DEFAULT true,
  sort_order       integer       NOT NULL DEFAULT 0,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS services_merchant_email_idx ON services (lower(merchant_email));
