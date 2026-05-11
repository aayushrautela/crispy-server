# Supabase RLS and RPC Tests

This directory contains tests for Supabase RLS policies and RPC functions.

## Test categories

- `rls/` - Row Level Security policy tests
- `rpc/` - RPC function behavior and authorization tests
- `helpers/` - Helper function tests

## Running tests

Tests should be run against a Supabase development branch or local instance with test data.

Example test structure:

```sql
-- Test: user can only read their own profiles
BEGIN;
  SELECT plan(2);
  
  -- Setup test user
  SET request.jwt.claims = '{"sub": "user-123"}';
  
  -- Test authorized access
  SELECT ok(
    EXISTS(SELECT 1 FROM profiles WHERE id = 'profile-owned-by-user-123'),
    'User can read own profile'
  );
  
  -- Test denied access
  SELECT is(
    (SELECT COUNT(*) FROM profiles WHERE id = 'profile-owned-by-other-user'),
    0::bigint,
    'User cannot read other user profiles'
  );
  
  SELECT * FROM finish();
ROLLBACK;
```

## Best practices

- Always use transactions and ROLLBACK to avoid polluting test data
- Test both authorized and denied access paths
- Verify RLS applies correctly for different user contexts
- Test service-role bypass behavior separately
