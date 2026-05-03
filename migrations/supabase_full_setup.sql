-- ============================================================
-- Text Boss — Full Supabase Schema Setup (safe to re-run)
-- Run this entire script in the Supabase SQL Editor.
-- All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- so it is safe to run on a database that already has some tables.
-- ============================================================


-- ── 000: entitlements ────────────────────────────────────────
-- CRITICAL: no migration file existed for this table previously.
-- Every auth check (verify-email, session-verify, chat, schedule-chat)
-- reads from this table. Stripe webhook writes to it on purchase.

CREATE TABLE IF NOT EXISTS entitlements (
  email                   text        PRIMARY KEY,
  entitled_tier           text        NOT NULL,
  subscription_status     text        NOT NULL DEFAULT 'active',
  current_period_end      timestamptz,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  price_id                text,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entitlements_stripe_customer
  ON entitlements (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entitlements_stripe_subscription
  ON entitlements (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;


-- ── 001: threads & messages ───────────────────────────────────

CREATE TABLE IF NOT EXISTS threads (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL,
  tier        text        NOT NULL,
  title       text        NOT NULL DEFAULT 'New conversation',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_threads_email      ON threads (email);
CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads (updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   uuid        NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role        text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_thread_id  ON messages (thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at);


-- ── 003: scheduling tables ────────────────────────────────────

CREATE TABLE IF NOT EXISTS availability (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email  text        NOT NULL,
  day_of_week  integer     NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time   text        NOT NULL,
  end_time     text        NOT NULL,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_availability_owner_email ON availability (owner_email);
CREATE INDEX IF NOT EXISTS idx_availability_day
  ON availability (owner_email, day_of_week)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS appointments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email      text        NOT NULL,
  client_name      text,
  client_contact   text,
  title            text,
  scheduled_date   date        NOT NULL,
  scheduled_time   text        NOT NULL,
  duration_minutes integer     NOT NULL DEFAULT 60,
  status           text        NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  notes            text,
  reminder_sent_at timestamptz,   -- migration 002
  client_email     text,          -- migration 005
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_owner_email ON appointments (owner_email);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled
  ON appointments (owner_email, scheduled_date, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_appointments_reminder
  ON appointments (scheduled_date, scheduled_time)
  WHERE status = 'confirmed' AND reminder_sent_at IS NULL;


-- ── 004: business_profiles & push_subscriptions ───────────────

CREATE TABLE IF NOT EXISTS business_profiles (
  email                  text        PRIMARY KEY,
  occupation             text,
  services               jsonb       NOT NULL DEFAULT '[]',
  buffer_before_minutes  integer     NOT NULL DEFAULT 15,
  buffer_after_minutes   integer     NOT NULL DEFAULT 15,
  working_hours          jsonb       DEFAULT NULL,
  onboarding_complete    boolean     NOT NULL DEFAULT false,
  booking_slug           text        UNIQUE,   -- migration 005
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_profiles_slug
  ON business_profiles (booking_slug)
  WHERE booking_slug IS NOT NULL;

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


-- ── 006: follow_up_jobs & follow_up_messages ──────────────────

CREATE TABLE IF NOT EXISTS follow_up_jobs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email      text        NOT NULL,
  client_name      text        NOT NULL,
  client_contact   text,
  service_name     text        NOT NULL,
  service_date     date        NOT NULL,
  notes            text,
  review_link      text,
  rebooking_link   text,
  status           text        NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_follow_up_jobs_owner ON follow_up_jobs (owner_email);

CREATE TABLE IF NOT EXISTS follow_up_messages (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid        NOT NULL REFERENCES follow_up_jobs(id) ON DELETE CASCADE,
  owner_email   text        NOT NULL,
  send_date     date        NOT NULL,
  purpose       text        NOT NULL,
  draft_message text        NOT NULL,
  status        text        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'notified', 'sent', 'skipped')),
  notified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_follow_up_messages_pending
  ON follow_up_messages (send_date)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_follow_up_messages_job   ON follow_up_messages (job_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_messages_owner ON follow_up_messages (owner_email);


-- ── Safe column additions (for existing partial installs) ─────
-- These are no-ops if the column already exists.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz DEFAULT NULL;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS client_email text;

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS booking_slug text;

-- Ensure unique constraint on booking_slug exists (ignore error if already present)
DO $$
BEGIN
  BEGIN
    ALTER TABLE business_profiles ADD CONSTRAINT business_profiles_booking_slug_key UNIQUE (booking_slug);
  EXCEPTION WHEN duplicate_table THEN NULL;
  END;
END $$;


-- ── 007: busy_blocks ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS busy_blocks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email  text        NOT NULL,
  block_date   date        NOT NULL,
  start_time   text        NOT NULL,
  end_time     text        NOT NULL,
  label        text,
  source       text        NOT NULL DEFAULT 'manual'
               CHECK (source IN ('ical_import', 'ai_parsed', 'manual')),
  import_batch uuid,
  expires_at   date,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_busy_blocks_owner_date
  ON busy_blocks (owner_email, block_date);

CREATE INDEX IF NOT EXISTS idx_busy_blocks_batch
  ON busy_blocks (import_batch)
  WHERE import_batch IS NOT NULL;


-- ── 008: password authentication ─────────────────────────────
-- CRITICAL: verify-email.js selects password_hash on every login attempt.
-- Without this column, all logins return server_error (500).

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


-- ── 009: services table + slot_duration_min ───────────────────

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


-- ── 010: scheduler memory (Black tier) ───────────────────────

CREATE TABLE IF NOT EXISTS scheduler_memory (
  owner_email  text        PRIMARY KEY,
  memory_text  text        NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL DEFAULT now()
);


-- ── 011: todos + business profile detail columns ──────────────

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS avatar_data       text,
  ADD COLUMN IF NOT EXISTS business_name     text,
  ADD COLUMN IF NOT EXISTS owner_first_name  text,
  ADD COLUMN IF NOT EXISTS owner_full_name   text,
  ADD COLUMN IF NOT EXISTS business_phone    text,
  ADD COLUMN IF NOT EXISTS website           text,
  ADD COLUMN IF NOT EXISTS abn               text,
  ADD COLUMN IF NOT EXISTS city              text;

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


-- ── 012: client_phone on appointments ────────────────────────

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_phone text;
