-- Add reminder tracking to appointments table
-- Used by send-reminders.js to flag appointments that have been queued for reminder

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_reminder
  ON appointments (scheduled_date, scheduled_time)
  WHERE status = 'confirmed' AND reminder_sent_at IS NULL;
