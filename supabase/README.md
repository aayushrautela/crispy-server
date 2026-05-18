# Supabase

Supabase is used **only for Auth**: JWT issuance, signup/signin, session management, and upstream auth-user administration where required.

- Product data lives in local Postgres.
- Do not add Supabase app-data migrations, RLS policies, RPCs, or PostgREST data paths.
- Use the local migration workflow for product schema changes.
