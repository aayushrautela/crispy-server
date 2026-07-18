ALTER TABLE user_state.provider_sessions
  ADD COLUMN IF NOT EXISTS oauth_return_to text;
