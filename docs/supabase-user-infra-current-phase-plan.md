# Supabase User Infrastructure Current Phase Implementation Plan

## Purpose

Implementation-level plan for the immediate Supabase user-infrastructure foundation phase.

The long-term roadmap lives in `docs/supabase-user-infra-long-term-plan.md`. This file is the working plan for the current phase only.

## Current phase

Phase 0 and Phase 1: contract freeze plus Supabase foundation.

## Non-negotiable boundary

This phase creates a safe Supabase foundation. It must not change production product behavior yet.

Do not change:

- current Fastify API behavior
- current local Postgres ownership
- current watch/history/recommendation/provider logic
- current client contracts
- current account deletion flow
- current AI/provider secret handling

Do create:

- Supabase account/profile/preference/entitlement foundation schema
- RLS helper functions and policies
- bootstrap path for Supabase Auth users
- clear mapping from current Crispy rows to future Supabase rows
- validation steps proving user isolation

## Codebase analysis summary

### Current auth model

Supabase Auth is already the identity provider, but Crispy creates its own local user row.

Relevant code:

- Supabase JWT verification: `src/lib/jwks.ts:11`
- Fastify auth plugin verifies JWT and extracts `payload.sub`: `src/http/plugins/auth.ts:46`
- `UserService.ensureAppUser` creates/updates local `app_users`: `src/modules/users/user.service.ts:12`
- `UserRepository.upsertFromAuthSubject` keys users by `auth_subject`: `src/modules/users/user.repo.ts:55`

Current local user schema:

- `app_users.id uuid primary key`
- `app_users.auth_subject text unique`
- `app_users.email text`
- `app_users.last_seen_at timestamptz`

Defined in:

- `migrations/0001_base_identity.sql:8`
- `migrations/0007_auth_subject_cutover.sql:1`

Implementation decision:

- Supabase `accounts.id` will be `auth.users.id` / `auth.uid()`.
- Existing Crispy `app_users.id` must be preserved later as `accounts.legacy_app_user_id` for backfill/compatibility.
- Do not attempt to keep `accounts.id = app_users.id`; that would fight Supabase Auth and RLS.

### Current profile model

Crispy currently has a profile-group model:

- `profile_groups`
- `profile_group_members`
- `profiles`

Defined in `migrations/0001_base_identity.sql:17`.

Runtime bootstrap:

- `ProfileGroupService.ensureDefaultProfileGroup` creates a default group and profile: `src/modules/profile-groups/profile-group.service.ts:12`
- Profile defaults come from app config: `src/config/app-config.ts:23`
- Example defaults are `Crispy Profile Group` and `Main`: `config/app-config.json.example:2`

Runtime access:

- Most profile reads/writes currently resolve by owner user through profile group: `src/modules/profiles/profile.repo.ts:92`
- Profile update requires owner account: `src/modules/profiles/profile.service.ts:46`
- Profile access helper is owner-based: `src/modules/profiles/profile-access.service.ts:8`

Implementation decision:

- Supabase foundation will flatten the owner relationship onto `profiles.account_id`.
- `profile_members` will be per-profile, not per-group.
- Existing `profiles.id` should be reused during later backfill so profile IDs stay stable.
- Existing `profiles.profile_group_id` should be preserved later as `profiles.legacy_profile_group_id`.
- First phase can create only default profiles. Multi-profile client creation can be added later through an RPC or direct client policy after the foundation is proven.

### Current profile fields

Current code exposes profile fields from `ProfileRecord`:

- `id`
- `profileGroupId`
- `name`
- `avatarKey`
- `isKids`
- `sortOrder`
- `createdByUserId`
- `createdAt`
- `updatedAt`

Relevant file:

- `src/modules/profiles/profile.repo.ts:4`

Implementation decision:

- Supabase `profiles` should use `avatar_key`, `is_kids`, and `sort_order` to match current code naming.
- Do not rename to `kid_mode` in the foundation schema.

### Current preferences model

Current account preferences are flexible JSONB:

- `account_settings.settings_json`: `migrations/0009_account_shared_settings.sql:1`
- `profile_settings.settings_json`: `migrations/0001_base_identity.sql:47`

Current account secrets are separate and encrypted:

- `account_secrets.secrets_json`: `migrations/0009_account_shared_settings.sql:7`
- encryption/decryption happens in `src/modules/users/account-settings.repo.ts:38`

Current safe account settings behavior:

- account settings reject secret fields: `src/modules/users/account-settings.service.ts:195`
- account settings remove client-forbidden AI metadata fields: `src/modules/users/account-settings.service.ts:281`
- account settings remove server-computed MDBList access: `src/modules/users/account-settings.service.ts:299`
- profile settings reject account-scoped fields: `src/modules/users/account-settings.service.ts:231`

Implementation decision:

- Current phase creates safe JSONB preference tables, not typed preference columns.
- Database check functions should mirror current service restrictions.
- Secrets stay out of current phase.
- Entitlements move to a dedicated table instead of staying inside settings JSONB.

### Current entitlement model

Current pricing tier is stored inside `account_settings.settings_json.pricingTier`.

Relevant code:

- tier values: `src/modules/users/account-settings.service.ts:24`
- default tier: `src/modules/users/account-settings.service.ts:26`
- client cannot patch tier through normal settings: `src/modules/users/account-settings.service.ts:226`
- admin route updates tier through service code: `src/http/routes/admin-api.ts:281`

Implementation decision:

- Supabase `account_entitlements` owns tier/status/features.
- Clients can read their own entitlement.
- Clients cannot insert/update/delete entitlement rows.
- Service role/admin paths update entitlements later.

### Current repo migration boundary

The existing `migrations/` directory is for Crispy Server's local Postgres migration runner:

- migration runner: `scripts/migrate.ts:29`
- runtime DB connection: `src/lib/db.ts:8`

Implementation decision:

- Do not add Supabase foundation SQL to the existing `migrations/` directory in this phase.
- Use Supabase MCP migrations against a Supabase development branch.
- If local Supabase CLI support is added later, create a separate `supabase/migrations/` tree.

### Current package scripts

Available quality gates from `package.json`:

```txt
npm run typecheck
npm test
npm run contract:check
```

There is no `lint` script in `package.json`.

### Supabase project baseline

MCP inspection baseline from 2026-05-10:

```txt
public tables: none
Supabase migrations: none
pgcrypto: installed in extensions schema
uuid-ossp: installed in extensions schema
Supabase Vault: installed
```

Implementation implication:

- There are no public table naming conflicts for the foundation schema.
- `gen_random_uuid()` is available through `pgcrypto`.

## Implementation decisions for this phase

### Identity

- `accounts.id = auth.users.id`.
- `accounts.legacy_app_user_id` is nullable and unique for later backfill.
- `accounts.email` is a nullable snapshot copied from Supabase Auth.
- `accounts.email` is not the authorization source.
- `auth.uid()` is the authorization source.

### Profiles

- `profiles.id` is the product profile ID.
- Later backfill should insert existing Crispy `profiles.id` values directly into Supabase `profiles.id`.
- `profiles.account_id` is the owning account.
- `profiles.legacy_profile_group_id` preserves current group lineage for migration/debugging.
- `profile_members` is per-profile.
- Initial default profile role is `owner`.
- Roles are text check constraints: `owner`, `member`, `viewer`.

### Preferences

- Use JSONB now because current code already treats settings as flexible JSON.
- Add database safety checks so clients cannot store current known secret/server-computed fields.
- Account preference unsafe keys:
  - `pricingTier`
  - `ai.api_key`
  - `mdblist.api_key`
  - `addons`
- Account `ai` unsafe nested keys:
  - `hasAiApiKey`
  - `defaultProviderId`
  - `providers`
  - `endpointUrl`
  - `providerId`
- Account `metadata` unsafe nested key:
  - `hasMdbListAccess`
- Profile preference unsafe keys:
  - `ai`
  - `ai.api_key`
  - `mdblist.api_key`
  - `addons`

### Entitlements

- `tier`: `free`, `lite`, `pro`, `ultra`
- `status`: `active`, `trialing`, `past_due`, `canceled`, `comped`
- default tier is `free`
- default status is `active`
- client read only
- service role/admin write only

### Client writes in this phase

Allowed after RLS validation:

- update own `accounts.display_name`
- update own `accounts.avatar_url`
- update own `account_preferences.settings_json`
- update accessible `profile_preferences.settings_json`
- update owned profile display fields if column grants are configured

Not allowed in this phase:

- client creates extra profiles
- client deletes profiles
- client updates entitlement
- client inserts membership
- client updates membership
- client writes secrets
- client writes watch/history/recommendation/provider data

## Migration set

Apply these migrations to a Supabase development branch first.

Recommended migration names:

```txt
create_user_infra_foundation
secure_user_infra_rls
bootstrap_user_infra_accounts
```

Do not merge to production until validation passes and the schema is approved.

## Migration 1: `create_user_infra_foundation`

### Objective

Create tables, constraints, update triggers, safety check functions, and indexes.

### SQL blueprint

```sql
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_safe_account_preferences(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(value) = 'object'
    and not (value ?| array['pricingTier', 'ai.api_key', 'mdblist.api_key', 'addons'])
    and (
      not (value ? 'ai')
      or (
        jsonb_typeof(value -> 'ai') = 'object'
        and not ((value -> 'ai') ?| array['hasAiApiKey', 'defaultProviderId', 'providers', 'endpointUrl', 'providerId'])
      )
    )
    and (
      not (value ? 'metadata')
      or (
        jsonb_typeof(value -> 'metadata') = 'object'
        and not ((value -> 'metadata') ? 'hasMdbListAccess')
      )
    );
$$;

create or replace function public.is_safe_profile_preferences(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(value) = 'object'
    and not (value ?| array['ai', 'ai.api_key', 'mdblist.api_key', 'addons']);
$$;

create table public.accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  legacy_app_user_id uuid unique,
  email text,
  display_name text,
  avatar_url text,
  deleted_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_display_name_not_blank check (display_name is null or btrim(display_name) <> '')
);

create trigger accounts_set_updated_at
before update on public.accounts
for each row execute function public.set_updated_at();

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  legacy_profile_group_id uuid,
  name text not null,
  avatar_key text,
  is_kids boolean not null default false,
  sort_order integer not null default 0,
  is_default boolean not null default false,
  created_by_account_id uuid references public.accounts(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_name_not_blank check (btrim(name) <> ''),
  constraint profiles_sort_order_nonnegative check (sort_order >= 0)
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create table public.profile_members (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, account_id),
  constraint profile_members_role_valid check (role in ('owner', 'member', 'viewer'))
);

create table public.account_preferences (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_preferences_safe_settings check (public.is_safe_account_preferences(settings_json))
);

create trigger account_preferences_set_updated_at
before update on public.account_preferences
for each row execute function public.set_updated_at();

create table public.profile_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_preferences_safe_settings check (public.is_safe_profile_preferences(settings_json))
);

create trigger profile_preferences_set_updated_at
before update on public.profile_preferences
for each row execute function public.set_updated_at();

create table public.account_entitlements (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  tier text not null default 'free',
  status text not null default 'active',
  features jsonb not null default '{}'::jsonb,
  renews_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_entitlements_tier_valid check (tier in ('free', 'lite', 'pro', 'ultra')),
  constraint account_entitlements_status_valid check (status in ('active', 'trialing', 'past_due', 'canceled', 'comped')),
  constraint account_entitlements_features_object check (jsonb_typeof(features) = 'object')
);

create trigger account_entitlements_set_updated_at
before update on public.account_entitlements
for each row execute function public.set_updated_at();

create index accounts_email_lower_idx
  on public.accounts (lower(email))
  where email is not null and deleted_at is null;

create index accounts_legacy_app_user_id_idx
  on public.accounts (legacy_app_user_id)
  where legacy_app_user_id is not null;

create index profiles_account_active_sort_idx
  on public.profiles (account_id, sort_order, created_at)
  where deleted_at is null;

create unique index profiles_one_default_active_per_account_idx
  on public.profiles (account_id)
  where is_default = true and deleted_at is null;

create index profiles_legacy_profile_group_id_idx
  on public.profiles (legacy_profile_group_id)
  where legacy_profile_group_id is not null;

create index profile_members_account_profile_idx
  on public.profile_members (account_id, profile_id);

create index profile_members_profile_role_idx
  on public.profile_members (profile_id, role);

create index account_entitlements_tier_idx
  on public.account_entitlements (tier);
```

### Review checklist

- [ ] Table names match long-term plan.
- [ ] `accounts.id` references `auth.users(id)`.
- [ ] `profiles.id` can accept existing legacy profile IDs during later backfill.
- [ ] `legacy_app_user_id` exists for later migration mapping.
- [ ] `legacy_profile_group_id` exists for later migration mapping.
- [ ] No secret table exists in this phase.
- [ ] No watch/history/recommendation/provider table exists in this phase.
- [ ] Preference check functions reject current known unsafe keys.
- [ ] Default active profile unique index exists.

## Migration 2: `secure_user_infra_rls`

### Objective

Enable RLS, create private helper functions, policies, and grants.

Column grants matter because RLS controls rows, not columns.

### SQL blueprint

```sql
grant usage on schema private to authenticated;

create or replace function private.is_account_owner(target_account_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select auth.uid() is not null and auth.uid() = target_account_id;
$$;

create or replace function private.profile_member_role(target_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pm.role
  from public.profile_members pm
  where pm.profile_id = target_profile_id
    and pm.account_id = auth.uid()
  limit 1;
$$;

create or replace function private.is_profile_member(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.profile_member_role(target_profile_id) is not null;
$$;

create or replace function private.can_manage_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.profile_member_role(target_profile_id) = 'owner';
$$;

create or replace function private.can_write_profile_preferences(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.profile_member_role(target_profile_id) in ('owner', 'member');
$$;

revoke all on function private.is_account_owner(uuid) from public;
revoke all on function private.profile_member_role(uuid) from public;
revoke all on function private.is_profile_member(uuid) from public;
revoke all on function private.can_manage_profile(uuid) from public;
revoke all on function private.can_write_profile_preferences(uuid) from public;

grant execute on function private.is_account_owner(uuid) to authenticated;
grant execute on function private.profile_member_role(uuid) to authenticated;
grant execute on function private.is_profile_member(uuid) to authenticated;
grant execute on function private.can_manage_profile(uuid) to authenticated;
grant execute on function private.can_write_profile_preferences(uuid) to authenticated;

alter table public.accounts enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_members enable row level security;
alter table public.account_preferences enable row level security;
alter table public.profile_preferences enable row level security;
alter table public.account_entitlements enable row level security;

revoke all on public.accounts from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
revoke all on public.profile_members from anon, authenticated;
revoke all on public.account_preferences from anon, authenticated;
revoke all on public.profile_preferences from anon, authenticated;
revoke all on public.account_entitlements from anon, authenticated;

grant select on public.accounts to authenticated;
grant update (display_name, avatar_url) on public.accounts to authenticated;

grant select on public.profiles to authenticated;
grant update (name, avatar_key, is_kids, sort_order) on public.profiles to authenticated;

grant select on public.profile_members to authenticated;

grant select, update on public.account_preferences to authenticated;
grant select, update on public.profile_preferences to authenticated;

grant select on public.account_entitlements to authenticated;

create policy accounts_select_own
on public.accounts
for select
to authenticated
using (
  (select auth.uid()) = id
  and deleted_at is null
);

create policy accounts_update_own_safe_columns
on public.accounts
for update
to authenticated
using (
  (select auth.uid()) = id
  and deleted_at is null
)
with check (
  (select auth.uid()) = id
  and deleted_at is null
);

create policy profiles_select_member
on public.profiles
for select
to authenticated
using (
  deleted_at is null
  and (select private.is_profile_member(id))
);

create policy profiles_update_owner_safe_columns
on public.profiles
for update
to authenticated
using (
  deleted_at is null
  and (select private.can_manage_profile(id))
)
with check (
  deleted_at is null
  and (select private.can_manage_profile(id))
);

create policy profile_members_select_accessible
on public.profile_members
for select
to authenticated
using (
  account_id = (select auth.uid())
  or (select private.is_profile_member(profile_id))
);

create policy account_preferences_select_own
on public.account_preferences
for select
to authenticated
using (account_id = (select auth.uid()));

create policy account_preferences_update_own
on public.account_preferences
for update
to authenticated
using (account_id = (select auth.uid()))
with check (
  account_id = (select auth.uid())
  and public.is_safe_account_preferences(settings_json)
);

create policy profile_preferences_select_member
on public.profile_preferences
for select
to authenticated
using ((select private.is_profile_member(profile_id)));

create policy profile_preferences_update_owner_or_member
on public.profile_preferences
for update
to authenticated
using ((select private.can_write_profile_preferences(profile_id)))
with check (
  (select private.can_write_profile_preferences(profile_id))
  and public.is_safe_profile_preferences(settings_json)
);

create policy account_entitlements_select_own
on public.account_entitlements
for select
to authenticated
using (account_id = (select auth.uid()));
```

### Review checklist

- [ ] No policy targets `anon`.
- [ ] All client-accessible tables have RLS enabled.
- [ ] Private helper functions use `set search_path = ''`.
- [ ] Membership helper functions are `security definer` to avoid recursive RLS.
- [ ] Policies use `(select auth.uid())` or wrapped helper calls for Supabase RLS performance.
- [ ] Column grants prevent clients updating entitlement/tier, owner IDs, and audit fields.
- [ ] `account_entitlements` has select-only client access.
- [ ] `profile_members` has select-only client access.
- [ ] There are no insert/delete grants for client roles in this phase.

## Migration 3: `bootstrap_user_infra_accounts`

### Objective

Create an account/profile bootstrap path for Supabase Auth users.

This replaces the future need for the Fastify auth plugin to create local app rows on every request, but does not cut over runtime behavior yet.

### SQL blueprint

```sql
create or replace function private.bootstrap_account(
  target_account_id uuid,
  target_email text,
  target_user_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_profile_id uuid;
  display_value text;
begin
  if target_account_id is null then
    return;
  end if;

  display_value := nullif(btrim(coalesce(
    target_user_metadata ->> 'full_name',
    target_user_metadata ->> 'name',
    target_email
  )), '');

  insert into public.accounts (id, email, display_name, last_seen_at)
  values (target_account_id, nullif(btrim(coalesce(target_email, '')), ''), display_value, now())
  on conflict (id)
  do update set
    email = excluded.email,
    display_name = coalesce(public.accounts.display_name, excluded.display_name),
    last_seen_at = now(),
    updated_at = now();

  insert into public.account_preferences (account_id)
  values (target_account_id)
  on conflict (account_id) do nothing;

  insert into public.account_entitlements (account_id, tier, status)
  values (target_account_id, 'free', 'active')
  on conflict (account_id) do nothing;

  select p.id
  into default_profile_id
  from public.profiles p
  where p.account_id = target_account_id
    and p.deleted_at is null
  order by p.is_default desc, p.sort_order asc, p.created_at asc
  limit 1;

  if default_profile_id is null then
    insert into public.profiles (
      account_id,
      name,
      is_default,
      sort_order,
      created_by_account_id
    )
    values (
      target_account_id,
      'Main',
      true,
      0,
      target_account_id
    )
    returning id into default_profile_id;
  end if;

  insert into public.profile_members (profile_id, account_id, role)
  values (default_profile_id, target_account_id, 'owner')
  on conflict (profile_id, account_id)
  do update set role = 'owner';

  insert into public.profile_preferences (profile_id)
  values (default_profile_id)
  on conflict (profile_id) do nothing;
end;
$$;

create or replace function private.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bootstrap_account(
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_bootstrap_account on auth.users;

create trigger on_auth_user_created_bootstrap_account
after insert on auth.users
for each row execute function private.handle_auth_user_created();

create or replace function public.bootstrap_current_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  claims := auth.jwt();

  perform private.bootstrap_account(
    auth.uid(),
    claims ->> 'email',
    coalesce(claims -> 'user_metadata', '{}'::jsonb)
  );
end;
$$;

revoke all on function private.bootstrap_account(uuid, text, jsonb) from public;
revoke all on function private.handle_auth_user_created() from public;
revoke all on function public.bootstrap_current_account() from public;

grant execute on function public.bootstrap_current_account() to authenticated;
```

### Existing auth user backfill command

Run only after reviewing existing Supabase Auth users.

```sql
select private.bootstrap_account(id, email, coalesce(raw_user_meta_data, '{}'::jsonb))
from auth.users;
```

### Review checklist

- [ ] Default profile name is `Main`, matching current example config.
- [ ] Trigger creates account preferences.
- [ ] Trigger creates account entitlement.
- [ ] Trigger creates one default profile if no active profile exists.
- [ ] Trigger creates owner membership.
- [ ] Trigger creates profile preferences.
- [ ] `public.bootstrap_current_account()` exists as a repair/manual bootstrap path.
- [ ] No secret rows are created.
- [ ] No watch/history/provider/recommendation rows are created.

## Supabase MCP execution plan

### Step 1: create development branch

Use Supabase MCP only after user approval.

- [ ] Confirm branch cost if required by the environment.
- [ ] Create a branch named `user-infra-foundation`.
- [ ] Wait until ready.
- [ ] Record branch id and project ref.

Record:

```txt
Branch name:
Branch id:
Branch project ref:
Created at:
```

### Step 2: apply migrations to branch

Apply in this order:

1. `create_user_infra_foundation`
2. `secure_user_infra_rls`
3. `bootstrap_user_infra_accounts`

After each migration:

- [ ] list tables with verbose output
- [ ] confirm migration appears in migration list
- [ ] inspect errors/warnings

### Step 3: generate Supabase TypeScript types

Use MCP type generation after branch schema stabilizes.

Do not wire generated types into runtime code in this phase unless explicitly approved.

Candidate future location:

```txt
src/generated/supabase.types.ts
```

If generated types are committed later, do not add `@supabase/supabase-js` yet unless runtime code starts using it.

### Step 4: advisor checks

Run:

- [ ] security advisors
- [ ] performance advisors

Expected items to verify:

- [ ] no public table without RLS
- [ ] no dangerous anon access
- [ ] no missing indexes for RLS helper access paths
- [ ] no policy recursion warnings
- [ ] no function search-path warning for security-definer functions

### Step 5: branch validation

Use disposable Supabase Auth test users.

Required users:

```txt
user_a@example.test
user_b@example.test
```

Required setup:

- [ ] create user A in Supabase Auth
- [ ] create user B in Supabase Auth
- [ ] confirm bootstrap created rows for both
- [ ] if trigger did not run for existing users, call `public.bootstrap_current_account()` as each user or run service backfill

Validation cases:

- [ ] anon cannot read `accounts`
- [ ] anon cannot read `profiles`
- [ ] user A can read own account
- [ ] user A cannot read user B account
- [ ] user A can update own `display_name`
- [ ] user A cannot update own `id`, `legacy_app_user_id`, `email`, `deleted_at`, or timestamps
- [ ] user A can read own default profile
- [ ] user A cannot read user B profile
- [ ] user A can update own profile `name`, `avatar_key`, `is_kids`, `sort_order`
- [ ] user A cannot update `account_id`, `is_default`, `created_by_account_id`, or `deleted_at`
- [ ] user A can read own `account_preferences`
- [ ] user A can update safe `account_preferences.settings_json`
- [ ] user A cannot store `pricingTier` in `account_preferences.settings_json`
- [ ] user A cannot store `ai.hasAiApiKey` in `account_preferences.settings_json`
- [ ] user A can read own `account_entitlements`
- [ ] user A cannot update `account_entitlements.tier`
- [ ] user A can read own `profile_preferences`
- [ ] user A cannot store top-level `ai` in `profile_preferences.settings_json`
- [ ] service role can read/write all foundation rows

### Optional SQL simulation pattern

Prefer real Supabase Auth sessions for final validation. SQL role simulation is useful for quick checks.

Pattern:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_A_UUID>', true);
select * from public.accounts;
rollback;
```

For anon checks:

```sql
begin;
set local role anon;
select * from public.accounts;
rollback;
```

## Later backfill mapping

Do not execute this in the current phase. This mapping explains why the schema has compatibility columns.

### `app_users` to `accounts`

Current source:

```txt
app_users.id
app_users.auth_subject
app_users.email
app_users.created_at
app_users.updated_at
app_users.last_seen_at
```

Future target:

```txt
accounts.id = app_users.auth_subject::uuid
accounts.legacy_app_user_id = app_users.id
accounts.email = app_users.email
accounts.created_at = app_users.created_at
accounts.updated_at = app_users.updated_at
accounts.last_seen_at = app_users.last_seen_at
```

Precondition:

- every `app_users.auth_subject` must be a valid Supabase Auth UUID.

Validation query for later local Crispy DB:

```sql
select id, auth_subject
from app_users
where auth_subject !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
```

### `profiles` to Supabase `profiles`

Current source:

```txt
profiles.id
profiles.profile_group_id
profiles.name
profiles.avatar_key
profiles.is_kids
profiles.sort_order
profiles.created_by_user_id
profiles.created_at
profiles.updated_at
profile_groups.owner_user_id
```

Future target:

```txt
profiles.id = existing profiles.id
profiles.account_id = owner account's auth.users.id
profiles.legacy_profile_group_id = profiles.profile_group_id
profiles.name = profiles.name
profiles.avatar_key = profiles.avatar_key
profiles.is_kids = profiles.is_kids
profiles.sort_order = profiles.sort_order
profiles.created_by_account_id = creator account's auth.users.id if available
profiles.created_at = profiles.created_at
profiles.updated_at = profiles.updated_at
```

### `profile_group_members` to `profile_members`

Current source is group-level membership. Future target is profile-level membership.

For every current group member, create one `profile_members` row for every profile in that group:

```txt
profile_members.profile_id = profiles.id
profile_members.account_id = member user's auth.users.id
profile_members.role = profile_group_members.role
```

Role normalization later:

```txt
owner -> owner
member -> member
unknown/other -> viewer or member after review
```

### `account_settings` to `account_preferences` and `account_entitlements`

Current source:

```txt
account_settings.app_user_id
account_settings.settings_json
```

Future target:

```txt
account_preferences.account_id = app user's auth.users.id
account_preferences.settings_json = settings_json minus pricingTier and unsafe/server-computed keys
account_entitlements.tier = settings_json->>'pricingTier' or free
```

### `profile_settings` to `profile_preferences`

Current source:

```txt
profile_settings.profile_id
profile_settings.settings_json
```

Future target:

```txt
profile_preferences.profile_id = profile_settings.profile_id
profile_preferences.settings_json = settings_json minus account-scoped keys
```

### `account_secrets`

Out of scope for this phase.

Later migration must handle:

- `ai.api_key`
- `mdblist.api_key`
- encryption strategy
- service-role-only access
- no client select policies

## Current phase repo work

This phase is documentation and Supabase branch work only.

Allowed repo changes now:

- update this plan
- update the long-term plan if decisions change
- optionally add generated Supabase types after schema is approved

Do not change now:

- `src/http/plugins/auth.ts`
- `src/modules/users/user.service.ts`
- `src/modules/profile-groups/profile-group.service.ts`
- `src/modules/profiles/profile.service.ts`
- `src/modules/users/account-settings.service.ts`
- existing local `migrations/`
- OpenAPI contracts
- package dependencies

Future code impact after foundation:

- `UserService.ensureAppUser` eventually stops owning account bootstrap.
- `ProfileService` eventually stops being the client-facing profile writer.
- `AccountSettingsService` eventually reads/writes Supabase preferences or becomes admin/service-only.
- `FeatureEntitlementService` eventually reads `account_entitlements` instead of `pricingTier` from JSON settings.
- Admin tier update route eventually writes `account_entitlements`.
- Internal services eventually resolve `legacy_app_user_id` during migration or switch to `auth.users.id`.

## Implementation order checklist

### Phase A: branch and baseline

- [ ] User approves using Supabase branch.
- [ ] Create Supabase development branch.
- [ ] Record baseline public tables: currently none.
- [ ] Record baseline migrations: currently none.
- [ ] Record baseline advisors.

### Phase B: foundation schema

- [ ] Apply `create_user_infra_foundation`.
- [ ] Confirm all six tables exist.
- [ ] Confirm all triggers exist.
- [ ] Confirm safety check functions exist.
- [ ] Confirm indexes exist.

### Phase C: RLS and grants

- [ ] Apply `secure_user_infra_rls`.
- [ ] Confirm RLS enabled on all six tables.
- [ ] Confirm no anon policies exist.
- [ ] Confirm authenticated grants are column-limited.
- [ ] Confirm entitlement has select-only client grants.
- [ ] Confirm membership has select-only client grants.

### Phase D: auth bootstrap

- [ ] Apply `bootstrap_user_infra_accounts`.
- [ ] Create test auth user A.
- [ ] Create test auth user B.
- [ ] Confirm account/profile/preference/entitlement rows are created.
- [ ] Confirm `public.bootstrap_current_account()` works for repair.

### Phase E: validation

- [ ] Validate anon cannot read.
- [ ] Validate user A/user B isolation.
- [ ] Validate safe update columns.
- [ ] Validate unsafe preference JSON is rejected.
- [ ] Validate entitlement writes are rejected.
- [ ] Validate service role can bootstrap/admin-write.
- [ ] Run security advisors.
- [ ] Run performance advisors.
- [ ] Generate TypeScript types.

### Phase F: production decision

Do not merge until:

- [ ] user approves final schema
- [ ] validation checklist passes
- [ ] advisors are reviewed
- [ ] rollback approach is accepted
- [ ] no runtime behavior has changed

## Rollback plan

### If still on development branch

- Delete/reset the Supabase branch.
- No app rollback needed.

### If accidentally merged to production before client cutover

- Leave tables unused.
- Disable auth trigger if it causes issues:

```sql
drop trigger if exists on_auth_user_created_bootstrap_account on auth.users;
```

- Apply corrective migration.
- Do not drop current Crispy local tables.

### If RLS policy is too permissive

- Revoke affected grants immediately.
- Drop or replace affected policies.
- Re-run validation before continuing.

## Current phase completion criteria

This phase is complete when:

- [ ] implementation-level plan is accepted
- [ ] Supabase branch exists
- [ ] foundation schema exists on branch
- [ ] RLS and grants are applied on branch
- [ ] bootstrap trigger/RPC works on branch
- [ ] user isolation validation passes
- [ ] security advisors are reviewed
- [ ] performance advisors are reviewed
- [ ] TypeScript types are generated if requested
- [ ] production behavior remains unchanged
- [ ] next phase can start: media state/watch schema

## Next phase preview

Next phase adds user media state, not metadata ownership.

Expected tables:

- `profile_media_state`
- `watch_events`
- `watch_history`
- `continue_watching_items`
- `profile_lists`
- `profile_list_items`
- `profile_ratings`

Rules carried forward:

- use `media_key` as canonical identity
- store stable IDs and watch facts in history
- keep metadata details on VPS
- allow richer snapshots only for generated read models like home feed
