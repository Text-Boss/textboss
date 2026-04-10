-- Business profile: stores occupation, services, buffer preferences, and working hours
-- One row per subscriber email. Used by the AI scheduler to find available slots.
CREATE TABLE IF NOT EXISTS business_profiles (
  email                 text        PRIMARY KEY,
  occupation            text,
  services              jsonb       NOT NULL DEFAULT '[]',
  -- services format: [{"name": "Cut & Style", "duration_minutes": 60}, ...]
  buffer_before_minutes integer     NOT NULL DEFAULT 15,
  buffer_after_minutes  integer     NOT NULL DEFAULT 15,
  working_hours         jsonb       DEFAULT NULL,
  -- working_hours format: {"1":{"start":"09:00","end":"18:00"}, "2":{...}, ...}
  -- keys are day_of_week as strings (0=Sun, 1=Mon, ..., 6=Sat)
  -- null means no envelope enforced (AI uses a default 08:00–20:00 window)
  onboarding_complete   boolean     NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Web Push subscriptions: one row per browser/device per user
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL,
  endpoint    text        NOT NULL,
  p256dh      text        NOT NULL,
  auth        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_email ON push_subscriptions (email);
