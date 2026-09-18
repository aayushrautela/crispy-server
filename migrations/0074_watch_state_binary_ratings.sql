ALTER TABLE user_state.watch_state
  DROP COLUMN rating,
  ADD COLUMN liked boolean,
  ADD COLUMN origin_rating numeric;

CREATE INDEX watch_state_ratings_idx
  ON user_state.watch_state (profile_id, last_played_at DESC, item_id)
  WHERE liked IS NOT NULL;

UPDATE recommendation_event_outbox
SET payload = payload || jsonb_build_object('origin_rating', rating)
WHERE rating IS NOT NULL;

ALTER TABLE recommendation_event_outbox
  ALTER COLUMN rating TYPE boolean
  USING CASE WHEN rating BETWEEN 7 AND 10 THEN true WHEN rating BETWEEN 1 AND 4 THEN false ELSE NULL END;

ALTER TABLE recommendation_event_outbox
  RENAME COLUMN rating TO liked;
