-- Drop the orphaned user-authored taste storage (Storage B).
-- public_account_taste_profiles / public_account_taste_profile_versions were
-- fully built but never wired into any consumer. Language/region live on the
-- profiles table (interfaceLanguage, region) and are exposed via profile-meta.

DROP TABLE IF EXISTS public_account_taste_profile_versions;
DROP TABLE IF EXISTS public_account_taste_profiles;
