UPDATE user_state.profile_watch_data_state
SET current_origin = 'native'
WHERE current_origin IS NULL
   OR current_origin NOT IN ('native', 'provider_import');

ALTER TABLE user_state.profile_watch_data_state
  ALTER COLUMN current_origin SET DEFAULT 'native',
  ALTER COLUMN current_origin SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profile_watch_data_state_current_origin_check'
      AND conrelid = 'user_state.profile_watch_data_state'::regclass
  ) THEN
    ALTER TABLE user_state.profile_watch_data_state
      ADD CONSTRAINT profile_watch_data_state_current_origin_check
      CHECK (current_origin IN ('native', 'provider_import'));
  END IF;
END $$;
