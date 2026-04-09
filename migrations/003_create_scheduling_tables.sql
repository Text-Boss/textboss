-- Availability slots: defines the business owner's weekly bookable hours
CREATE TABLE IF NOT EXISTS availability (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email   text        NOT NULL,
  day_of_week   integer     NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    text        NOT NULL,
  end_time      text        NOT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_availability_owner_email ON availability (owner_email);
CREATE INDEX IF NOT EXISTS idx_availability_day ON availability (owner_email, day_of_week) WHERE is_active = true;

-- Appointments: booked sessions for the business owner
CREATE TABLE IF NOT EXISTS appointments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email      text        NOT NULL,
  client_name      text,
  client_contact   text,
  title            text,
  scheduled_date   date        NOT NULL,
  scheduled_time   text        NOT NULL,
  duration_minutes integer     NOT NULL DEFAULT 60,
  status           text        NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  notes            text,
  reminder_sent_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_owner_email   ON appointments (owner_email);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled     ON appointments (owner_email, scheduled_date, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_appointments_reminder
  ON appointments (scheduled_date, scheduled_time)
  WHERE status = 'confirmed' AND reminder_sent_at IS NULL;
