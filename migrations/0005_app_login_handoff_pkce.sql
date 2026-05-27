ALTER TABLE private.app_login_handoff_codes
  ADD COLUMN client_id text NOT NULL DEFAULT '',
  ADD COLUMN code_challenge text NOT NULL DEFAULT '',
  ADD COLUMN code_challenge_method text NOT NULL DEFAULT 'S256',
  ADD COLUMN state text NOT NULL DEFAULT '';

ALTER TABLE private.app_login_handoff_codes
  ALTER COLUMN client_id DROP DEFAULT,
  ALTER COLUMN code_challenge DROP DEFAULT,
  ALTER COLUMN code_challenge_method DROP DEFAULT,
  ALTER COLUMN state DROP DEFAULT;

ALTER TABLE private.app_login_handoff_codes
  ADD CONSTRAINT app_login_handoff_code_challenge_method_check
    CHECK (code_challenge_method = 'S256');

ALTER TABLE private.app_login_handoff_codes
  ADD CONSTRAINT app_login_handoff_state_length_check
    CHECK (length(state) >= 16 AND length(state) <= 256);
