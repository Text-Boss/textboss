-- 006: Follow-Up Jobs & Messages
-- Automated client follow-up system for Pro and Black tiers.

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

CREATE TABLE IF NOT EXISTS follow_up_messages (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid        NOT NULL REFERENCES follow_up_jobs(id) ON DELETE CASCADE,
  owner_email      text        NOT NULL,
  send_date        date        NOT NULL,
  purpose          text        NOT NULL,
  draft_message    text        NOT NULL,
  status           text        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'notified', 'sent', 'skipped')),
  notified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_follow_up_jobs_owner ON follow_up_jobs (owner_email);
CREATE INDEX IF NOT EXISTS idx_follow_up_messages_pending ON follow_up_messages (send_date) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_follow_up_messages_job ON follow_up_messages (job_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_messages_owner ON follow_up_messages (owner_email);
