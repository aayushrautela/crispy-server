# Supabase

Supabase is used **only for Auth** — JWT issuance, signup/signin, session management.

- All user data (profiles, watch history, recommendations, etc.) lives in local Postgres.
- The Supabase `public` schema has been stripped of user tables — only Supabase-managed `auth` schema remains.
- See `docs/supabase-fastify-rls-target-architecture-plan.md` for the historical migration plan.
