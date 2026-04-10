ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS booking_slug text UNIQUE;
CREATE INDEX IF NOT EXISTS idx_business_profiles_slug ON business_profiles (booking_slug) WHERE booking_slug IS NOT NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_email text;
