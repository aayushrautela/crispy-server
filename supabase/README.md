# Supabase Schema and RLS

This directory contains Supabase project schema migrations, RLS policies, helper functions, and RPC definitions.

## Migration workflow

1. Write migration SQL in `supabase/migrations/YYYYMMDDHHMMSS_description.sql`
2. Test migration locally or on a development branch
3. Review RLS policies, grants, and security definer functions
4. Deploy to production through CI/CD or manual apply

## RLS and security rules

- Every user-accessible table must have RLS enabled
- User-scoped RPCs must validate profile membership using `auth.uid()` and RLS helpers
- Service-role access bypasses RLS and is restricted to trusted backend jobs only
- All RLS helpers must use fixed `search_path` to prevent schema injection
- Prefer `security invoker` for user-visible RPCs unless `security definer` is required to avoid recursive RLS

## Testing

- Unit tests for RLS policies should verify authorized and denied access
- Integration tests should call RPCs with real user JWTs and verify RLS enforcement
- Service-role paths must be tested separately with explicit authorization checks

## Documentation

See `docs/supabase-fastify-rls-target-architecture-plan.md` for the full migration plan and security model.
