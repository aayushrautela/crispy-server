ALTER TABLE taste_profiles
  ADD COLUMN IF NOT EXISTS drivers jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE taste_profiles
  ADD CONSTRAINT taste_profiles_drivers_array CHECK (jsonb_typeof(drivers) = 'array');
