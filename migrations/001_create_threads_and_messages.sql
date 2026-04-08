-- Conversation threads for Text Boss
-- Threads store per-user, named conversation sessions
-- Messages store the full chat history for each thread

CREATE TABLE IF NOT EXISTS threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  tier text NOT NULL,
  title text NOT NULL DEFAULT 'New conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_threads_email ON threads (email);
CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads (updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages (thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at);
