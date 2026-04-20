-- 010: Persistent scheduler memory for Black tier

CREATE TABLE IF NOT EXISTS scheduler_memory (
  owner_email  text        PRIMARY KEY,
  memory_text  text        NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL DEFAULT now()
);
