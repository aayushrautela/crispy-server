ALTER TABLE app_users
    RENAME COLUMN supabase_auth_user_id TO auth_subject;

ALTER TABLE app_users
    ALTER COLUMN auth_subject TYPE text USING auth_subject::text;
