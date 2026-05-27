ALTER TABLE user_state.provider_sessions
  ADD COLUMN state_token_hash text;

UPDATE user_state.provider_sessions
  SET state_token_hash = encode(sha256(state_token::bytea), 'hex')
  WHERE state_token IS NOT NULL;

CREATE INDEX provider_sessions_state_token_hash_idx
  ON user_state.provider_sessions (state_token_hash)
  WHERE state_token_hash IS NOT NULL;
