-- Single-layer TMDB storage: entity tables become the only cache.
-- Core rows hold language-invariant facts; translatable text moves to
-- tmdb_title_translations (one row per base language, ISO 639-1).

CREATE TABLE tmdb_title_translations (
  media_type text NOT NULL,
  tmdb_id integer NOT NULL,
  lang text NOT NULL,
  name text,
  overview text,
  tagline text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (media_type, tmdb_id, lang)
);

INSERT INTO tmdb_title_translations (media_type, tmdb_id, lang, name, overview, tagline)
SELECT media_type, tmdb_id, split_part(language, '-', 1), name, overview, tagline
FROM tmdb_titles
WHERE name IS NOT NULL OR overview IS NOT NULL OR tagline IS NOT NULL
ON CONFLICT (media_type, tmdb_id, lang) DO UPDATE SET
  name = EXCLUDED.name,
  overview = EXCLUDED.overview,
  tagline = EXCLUDED.tagline;

ALTER TABLE tmdb_titles DROP CONSTRAINT tmdb_titles_pkey;
DROP INDEX IF EXISTS tmdb_titles_name_trgm_idx;

ALTER TABLE tmdb_titles
  DROP COLUMN language,
  DROP COLUMN name,
  DROP COLUMN overview,
  DROP COLUMN tagline;

-- 'en' is the guaranteed fallback anchor for every title.
UPDATE tmdb_titles SET original_language = 'en' WHERE original_language IS NULL OR original_language = '';

ALTER TABLE tmdb_titles ADD PRIMARY KEY (media_type, tmdb_id);

-- Language-tagged artwork. One row per uploaded variant; selection happens at read time.
CREATE TABLE tmdb_images (
  media_type text NOT NULL,
  tmdb_id integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('poster', 'backdrop', 'logo')),
  file_path text NOT NULL,
  iso_639_1 text,
  vote_average numeric,
  vote_count integer,
  width integer,
  height integer,
  PRIMARY KEY (media_type, tmdb_id, kind, file_path)
);

CREATE INDEX tmdb_images_pick_idx ON tmdb_images (media_type, tmdb_id, kind);

-- Written reviews from TMDB (and merged Trakt fallbacks).
CREATE TABLE tmdb_reviews (
  media_type text NOT NULL,
  tmdb_id integer NOT NULL,
  source text NOT NULL DEFAULT 'tmdb' CHECK (source IN ('tmdb', 'trakt')),
  review_key text NOT NULL,
  author text,
  author_username text,
  content text NOT NULL,
  lang text,
  url text,
  rating text,
  avatar_url text,
  created_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (media_type, tmdb_id, source, review_key)
);

CREATE INDEX tmdb_reviews_title_idx ON tmdb_reviews (media_type, tmdb_id);

-- Edges between a source (title or collection) and related titles.
CREATE TABLE tmdb_title_relations (
  source_media_type text NOT NULL,   -- movie | tv | collection
  source_tmdb_id integer NOT NULL,
  relation_kind text NOT NULL,       -- recommendation | similar | collection_part
  target_media_type text NOT NULL,   -- movie | tv
  target_tmdb_id integer NOT NULL,
  rank integer NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_media_type, source_tmdb_id, relation_kind, target_media_type, target_tmdb_id)
);

CREATE INDEX tmdb_title_relations_target_idx ON tmdb_title_relations (target_media_type, target_tmdb_id);

-- People get real columns; the table existed but was never populated.
ALTER TABLE tmdb_people
  ADD COLUMN IF NOT EXISTS known_for_department text,
  ADD COLUMN IF NOT EXISTS biography text,
  ADD COLUMN IF NOT EXISTS birthday date,
  ADD COLUMN IF NOT EXISTS deathday date,
  ADD COLUMN IF NOT EXISTS place_of_birth text,
  ADD COLUMN IF NOT EXISTS profile_path text,
  ADD COLUMN IF NOT EXISTS popularity numeric,
  ADD COLUMN IF NOT EXISTS adult boolean,
  ADD COLUMN IF NOT EXISTS homepage text,
  ADD COLUMN IF NOT EXISTS also_known_as jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE tmdb_person_credits (
  person_tmdb_id integer NOT NULL,
  credit_kind text NOT NULL CHECK (credit_kind IN ('cast', 'crew')),
  target_media_type text NOT NULL,
  target_tmdb_id integer NOT NULL,
  character text,
  department text,
  job text,
  rank integer NOT NULL DEFAULT 0,
  PRIMARY KEY (person_tmdb_id, credit_kind, target_media_type, target_tmdb_id)
);

CREATE INDEX tmdb_person_credits_person_idx ON tmdb_person_credits (person_tmdb_id, credit_kind, rank);
CREATE INDEX tmdb_person_credits_target_idx ON tmdb_person_credits (target_media_type, target_tmdb_id);

CREATE INDEX tmdb_people_name_trgm_idx ON tmdb_people USING gin (lower(name) gin_trgm_ops);

-- Negative external-id lookups: tmdb_id stays NULL with not_found_at set,
-- replacing the old negative HTTP-response cache.
ALTER TABLE tmdb_external_ids ALTER COLUMN tmdb_id DROP NOT NULL;
ALTER TABLE tmdb_external_ids ADD COLUMN IF NOT EXISTS not_found_at timestamptz;

-- Child tables share the title lifecycle: purging an expired title removes its dependents.
ALTER TABLE tmdb_title_translations
  ADD CONSTRAINT tmdb_title_translations_title_fk
  FOREIGN KEY (media_type, tmdb_id) REFERENCES tmdb_titles (media_type, tmdb_id) ON DELETE CASCADE;
ALTER TABLE tmdb_images
  ADD CONSTRAINT tmdb_images_title_fk
  FOREIGN KEY (media_type, tmdb_id) REFERENCES tmdb_titles (media_type, tmdb_id) ON DELETE CASCADE;
ALTER TABLE tmdb_reviews
  ADD CONSTRAINT tmdb_reviews_title_fk
  FOREIGN KEY (media_type, tmdb_id) REFERENCES tmdb_titles (media_type, tmdb_id) ON DELETE CASCADE;
