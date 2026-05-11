drop function if exists public.list_watch_history_page(uuid, integer, timestamptz, uuid);
drop function if exists public.list_continue_watching_page(uuid, integer, timestamptz, text);
drop function if exists public.list_profile_list_items_page(uuid, text, integer, timestamptz, text);
drop function if exists public.list_profile_ratings_page(uuid, integer, timestamptz, text);

drop view if exists public.watch_history_with_cards;
drop view if exists public.history_with_cards;
drop view if exists public.continue_watching_with_cards;
drop view if exists public.profile_list_items_with_cards;
drop view if exists public.profile_ratings_with_cards;

create or replace function public.list_watch_history_page(
  p_profile_id uuid,
  p_limit integer default 50,
  p_cursor_watched_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table(
  id uuid,
  account_id uuid,
  profile_id uuid,
  media_key text,
  media_type text,
  watched_at timestamptz,
  source_kind text,
  created_at timestamptz
)
language plpgsql
security definer
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not private.is_profile_member(p_profile_id) then
    raise exception 'access denied';
  end if;

  return query
  select
    history.id,
    history.account_id,
    history.profile_id,
    history.media_key,
    history.media_type,
    history.watched_at,
    history.source_kind,
    history.created_at
  from public.watch_history history
  where history.profile_id = p_profile_id
    and (
      p_cursor_watched_at is null
      or history.watched_at < p_cursor_watched_at
      or (history.watched_at = p_cursor_watched_at and history.id < p_cursor_id)
    )
  order by history.watched_at desc, history.id desc
  limit greatest(1, least(p_limit, 100)) + 1;
end;
$$;

create or replace function public.list_continue_watching_page(
  p_profile_id uuid,
  p_limit integer default 20,
  p_cursor_last_activity_at timestamptz default null,
  p_cursor_title_media_key text default null
)
returns table(
  account_id uuid,
  profile_id uuid,
  title_media_key text,
  playable_media_key text,
  media_type text,
  position_seconds integer,
  duration_seconds integer,
  progress_bps smallint,
  last_activity_at timestamptz,
  dismissed_at timestamptz,
  source_kind text,
  source_provider text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not private.is_profile_member(p_profile_id) then
    raise exception 'access denied';
  end if;

  return query
  select
    cw.account_id,
    cw.profile_id,
    cw.title_media_key,
    cw.playable_media_key,
    cw.media_type,
    cw.position_seconds,
    cw.duration_seconds,
    cw.progress_bps,
    cw.last_activity_at,
    cw.dismissed_at,
    cw.source_kind,
    cw.source_provider,
    cw.created_at,
    cw.updated_at
  from public.continue_watching_items cw
  where cw.profile_id = p_profile_id
    and cw.dismissed_at is null
    and cw.last_activity_at is not null
    and (
      p_cursor_last_activity_at is null
      or cw.last_activity_at < p_cursor_last_activity_at
      or (cw.last_activity_at = p_cursor_last_activity_at and cw.title_media_key < p_cursor_title_media_key)
    )
  order by cw.last_activity_at desc, cw.title_media_key desc
  limit greatest(1, least(p_limit, 100)) + 1;
end;
$$;

create or replace function public.list_profile_list_items_page(
  p_profile_id uuid,
  p_list_kind text,
  p_limit integer default 50,
  p_cursor_added_at timestamptz default null,
  p_cursor_media_key text default null
)
returns table(
  account_id uuid,
  profile_id uuid,
  list_kind text,
  media_key text,
  media_type text,
  added_at timestamptz,
  source_kind text,
  source_provider text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not private.is_profile_member(p_profile_id) then
    raise exception 'access denied';
  end if;

  if p_list_kind not in ('watchlist', 'favorites') then
    raise exception 'invalid list kind';
  end if;

  return query
  select
    item.account_id,
    item.profile_id,
    item.list_kind,
    item.media_key,
    item.media_type,
    item.added_at,
    item.source_kind,
    item.source_provider,
    item.created_at,
    item.updated_at
  from public.profile_list_items item
  where item.profile_id = p_profile_id
    and item.list_kind = p_list_kind
    and (
      p_cursor_added_at is null
      or item.added_at < p_cursor_added_at
      or (item.added_at = p_cursor_added_at and item.media_key < p_cursor_media_key)
    )
  order by item.added_at desc, item.media_key desc
  limit greatest(1, least(p_limit, 100)) + 1;
end;
$$;

create or replace function public.list_profile_ratings_page(
  p_profile_id uuid,
  p_limit integer default 50,
  p_cursor_rated_at timestamptz default null,
  p_cursor_media_key text default null
)
returns table(
  account_id uuid,
  profile_id uuid,
  media_key text,
  media_type text,
  rating numeric,
  rated_at timestamptz,
  source_kind text,
  source_provider text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not private.is_profile_member(p_profile_id) then
    raise exception 'access denied';
  end if;

  return query
  select
    rating.account_id,
    rating.profile_id,
    rating.media_key,
    rating.media_type,
    rating.rating,
    rating.rated_at,
    rating.source_kind,
    rating.source_provider,
    rating.created_at,
    rating.updated_at
  from public.profile_ratings rating
  where rating.profile_id = p_profile_id
    and (
      p_cursor_rated_at is null
      or rating.rated_at < p_cursor_rated_at
      or (rating.rated_at = p_cursor_rated_at and rating.media_key < p_cursor_media_key)
    )
  order by rating.rated_at desc, rating.media_key desc
  limit greatest(1, least(p_limit, 100)) + 1;
end;
$$;

grant execute on function public.list_watch_history_page(uuid, integer, timestamptz, uuid) to authenticated;
grant execute on function public.list_continue_watching_page(uuid, integer, timestamptz, text) to authenticated;
grant execute on function public.list_profile_list_items_page(uuid, text, integer, timestamptz, text) to authenticated;
grant execute on function public.list_profile_ratings_page(uuid, integer, timestamptz, text) to authenticated;

drop table if exists public.media_card_snapshots;
