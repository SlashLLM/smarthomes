-- SmartHomes property income calculator: estimate cache, locality rollup, leads.
--
-- Run with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
--
-- Access model: the serverless functions in api/ connect with the ANON key, so every
-- statement they issue runs as the `anon` role. RLS is enabled on all three tables with
-- NO policies, which denies `anon` and `authenticated` outright; table-level GRANTs are
-- revoked from them as well. The only way in is the small set of `security definer`
-- functions at the bottom of this file, each of which validates its input.
--
-- Treat the anon key as public even though it is server-only today. Anyone holding it can
-- call exactly these RPCs and nothing else: no table reads, no arbitrary writes, no way
-- to enumerate cached estimates or read back leads.

-- ---------------------------------------------------------------------------
-- Exact per-property estimate cache. One row per (place, bedrooms, dwelling type).
-- ---------------------------------------------------------------------------
create table if not exists public.estimate_cache (
  cache_key         text primary key,
  place_id          text        not null,
  formatted_address text        not null,
  locality          text,
  region            text,
  bedrooms          smallint    not null,
  dwelling_type     text        not null,
  payload           jsonb       not null,
  model             text,
  hits              integer     not null default 0,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '1 month'
);

-- Drives the purge job and the `expires_at > now()` predicate on every read.
create index if not exists estimate_cache_expires_at_idx
  on public.estimate_cache (expires_at);

-- Supports the locality rollup recompute.
create index if not exists estimate_cache_locality_idx
  on public.estimate_cache (locality, bedrooms, dwelling_type);

-- ---------------------------------------------------------------------------
-- Suburb-level rollup. Grounds the OpenAI prompt so neighbouring properties don't
-- drift apart, and acts as the fallback when OpenAI is down or unconfigured.
-- ---------------------------------------------------------------------------
create table if not exists public.locality_stats (
  locality          text        not null,
  region            text,
  bedrooms          smallint    not null,
  dwelling_type     text        not null,
  weekly_rent       numeric(10,2),
  nightly_rate      numeric(10,2),
  occupancy         numeric(4,3),
  sample_size       integer     not null default 0,
  updated_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '1 month',
  primary key (locality, bedrooms, dwelling_type)
);

create index if not exists locality_stats_expires_at_idx
  on public.locality_stats (expires_at);

-- ---------------------------------------------------------------------------
-- Leads. Business records — deliberately NOT covered by the purge job.
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id                  uuid primary key default gen_random_uuid(),
  name                text        not null,
  email               text        not null,
  phone               text,
  place_id            text,
  formatted_address   text,
  bedrooms            smallint,
  dwelling_type       text,
  scenario            text,
  current_weekly_rent numeric(10,2),
  estimate            jsonb,
  projection          jsonb,
  created_at          timestamptz not null default now(),
  emailed_at          timestamptz
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);

-- ---------------------------------------------------------------------------
-- Lock the tables down. RLS on + zero policies == no direct access for anon or
-- authenticated. The REVOKEs are belt and braces: RLS alone already denies, but a
-- policy added carelessly later would otherwise open the table up immediately.
-- ---------------------------------------------------------------------------
alter table public.estimate_cache enable row level security;
alter table public.locality_stats enable row level security;
alter table public.leads          enable row level security;

revoke all on public.estimate_cache from anon, authenticated;
revoke all on public.locality_stats from anon, authenticated;
revoke all on public.leads          from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared input guard. Mirrors DWELLING_TYPES / BEDROOM_RANGE in
-- api/_lib/config.js — the API layer validates for good error messages, this
-- layer validates because the anon key is a public credential.
-- ---------------------------------------------------------------------------
create or replace function public.assert_dims(p_bedrooms smallint, p_dwelling_type text)
returns void
language plpgsql
immutable
set search_path = public
as $fn$
begin
  if p_bedrooms is null or p_bedrooms < 1 or p_bedrooms > 8 then
    raise exception 'bedrooms out of range: %', p_bedrooms using errcode = '22023';
  end if;
  if p_dwelling_type is null or p_dwelling_type not in ('house', 'apartment', 'flat') then
    raise exception 'unknown dwelling_type: %', p_dwelling_type using errcode = '22023';
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Cache read. Returns only the fields the API needs, only while unexpired.
-- The `expires_at > now()` predicate here is what actually enforces the TTL;
-- the purge job below only reclaims storage.
-- ---------------------------------------------------------------------------
create or replace function public.get_cached_estimate(p_cache_key text)
returns table (payload jsonb, model text, created_at timestamptz, hits integer)
language sql
stable
security definer
set search_path = public
as $fn$
  select c.payload, c.model, c.created_at, c.hits
    from public.estimate_cache c
   where c.cache_key = p_cache_key
     and c.expires_at > now();
$fn$;

-- ---------------------------------------------------------------------------
-- Atomic hit counter, so a cache hit doesn't need a read-modify-write round trip.
-- ---------------------------------------------------------------------------
create or replace function public.bump_cache_hit(p_cache_key text)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.estimate_cache
     set hits = hits + 1
   where cache_key = p_cache_key;
$fn$;

-- ---------------------------------------------------------------------------
-- Recompute one locality rollup from the unexpired cache rows that feed it.
-- Called from put_cached_estimate, never directly by the API. Using the median
-- rather than a running average keeps a single wild model output from skewing
-- the fallback.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_locality_stats(
  p_locality      text,
  p_region        text,
  p_bedrooms      smallint,
  p_dwelling_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.locality_stats as ls (
    locality, region, bedrooms, dwelling_type,
    weekly_rent, nightly_rate, occupancy, sample_size,
    updated_at, expires_at
  )
  select
    p_locality,
    p_region,
    p_bedrooms,
    p_dwelling_type,
    percentile_cont(0.5) within group (order by (payload->>'weeklyMarketRent')::numeric),
    percentile_cont(0.5) within group (order by (payload->>'nightlyRate')::numeric),
    percentile_cont(0.5) within group (order by (payload->>'occupancy')::numeric),
    count(*),
    now(),
    now() + interval '1 month'
  from public.estimate_cache
  where locality      = p_locality
    and bedrooms      = p_bedrooms
    and dwelling_type = p_dwelling_type
    and expires_at    > now()
  having count(*) > 0
  on conflict (locality, bedrooms, dwelling_type) do update
    set region       = excluded.region,
        weekly_rent  = excluded.weekly_rent,
        nightly_rate = excluded.nightly_rate,
        occupancy    = excluded.occupancy,
        sample_size  = excluded.sample_size,
        updated_at   = excluded.updated_at,
        expires_at   = excluded.expires_at;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Cache write. The only write path into estimate_cache, so all the validation a
-- service-role client would have skipped past lives here.
--
-- Rolls the new row into the suburb tier itself rather than exposing
-- refresh_locality_stats to anon — one round trip, one less callable surface.
-- ---------------------------------------------------------------------------
create or replace function public.put_cached_estimate(
  p_cache_key         text,
  p_place_id          text,
  p_formatted_address text,
  p_locality          text,
  p_region            text,
  p_bedrooms          smallint,
  p_dwelling_type     text,
  p_payload           jsonb,
  p_model             text,
  p_ttl_days          integer default 30
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_weekly  numeric := (p_payload->>'weeklyMarketRent')::numeric;
  v_nightly numeric := (p_payload->>'nightlyRate')::numeric;
  v_occ     numeric := (p_payload->>'occupancy')::numeric;
  v_expires timestamptz;
begin
  -- A cache key is always a sha256 hex digest (see cacheKey() in api/_lib/cache.js).
  -- Anything else is a caller writing rows we would never look up.
  if p_cache_key !~ '^[0-9a-f]{64}$' then
    raise exception 'malformed cache_key' using errcode = '22023';
  end if;

  perform public.assert_dims(p_bedrooms, p_dwelling_type);

  if coalesce(length(p_place_id), 0) not between 1 and 200
     or coalesce(length(p_formatted_address), 0) not between 1 and 300
     or coalesce(length(p_locality), 0) > 120
     or coalesce(length(p_region), 0) > 120
     or coalesce(length(p_model), 0) > 120 then
    raise exception 'place fields out of range' using errcode = '22023';
  end if;

  if p_ttl_days is null or p_ttl_days < 1 or p_ttl_days > 365 then
    raise exception 'ttl_days out of range: %', p_ttl_days using errcode = '22023';
  end if;

  -- Same plausibility bounds as BOUNDS in api/_lib/config.js. A wrong number on
  -- the hero card is a commercial promise, so it must not reach the cache either.
  if v_weekly is null or v_weekly < 150 or v_weekly > 5000
     or v_nightly is null or v_nightly < 50 or v_nightly > 3000
     or v_occ is null or v_occ < 0.3 or v_occ > 0.95 then
    raise exception 'payload outside plausibility bounds' using errcode = '22023';
  end if;

  v_expires := now() + make_interval(days => p_ttl_days);

  insert into public.estimate_cache (
    cache_key, place_id, formatted_address, locality, region,
    bedrooms, dwelling_type, payload, model, created_at, expires_at
  )
  values (
    p_cache_key, p_place_id, p_formatted_address, p_locality, p_region,
    p_bedrooms, p_dwelling_type, p_payload, p_model, now(), v_expires
  )
  on conflict (cache_key) do update
    set place_id          = excluded.place_id,
        formatted_address = excluded.formatted_address,
        locality          = excluded.locality,
        region            = excluded.region,
        bedrooms          = excluded.bedrooms,
        dwelling_type     = excluded.dwelling_type,
        payload           = excluded.payload,
        model             = excluded.model,
        created_at        = excluded.created_at,
        expires_at        = excluded.expires_at;

  if p_locality is not null then
    perform public.refresh_locality_stats(
      p_locality, p_region, p_bedrooms, p_dwelling_type
    );
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Suburb rollup read. Unexpired rows only, same as the exact tier.
-- ---------------------------------------------------------------------------
create or replace function public.get_locality_stats(
  p_locality      text,
  p_bedrooms      smallint,
  p_dwelling_type text
)
returns table (
  weekly_rent  numeric,
  nightly_rate numeric,
  occupancy    numeric,
  sample_size  integer,
  updated_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select s.weekly_rent, s.nightly_rate, s.occupancy, s.sample_size, s.updated_at
    from public.locality_stats s
   where s.locality      = p_locality
     and s.bedrooms      = p_bedrooms
     and s.dwelling_type = p_dwelling_type
     and s.expires_at    > now();
$fn$;

-- ---------------------------------------------------------------------------
-- Lead capture. Insert-only by design: there is no readback RPC, so the anon key
-- can add a lead but can never list, alter or delete one.
-- ---------------------------------------------------------------------------
create or replace function public.insert_lead(
  p_name                text,
  p_email               text,
  p_phone               text     default null,
  p_place_id            text     default null,
  p_formatted_address   text     default null,
  p_bedrooms            smallint default null,
  p_dwelling_type       text     default null,
  p_scenario            text     default null,
  p_current_weekly_rent numeric  default null,
  p_estimate            jsonb    default null,
  p_projection          jsonb    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  if p_name is null or length(btrim(p_name)) < 2 or length(p_name) > 120 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  if p_email is null or length(p_email) > 200
     or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  if coalesce(length(p_phone), 0) > 40
     or coalesce(length(p_place_id), 0) > 200
     or coalesce(length(p_formatted_address), 0) > 300
     or coalesce(length(p_scenario), 0) > 40 then
    raise exception 'lead fields out of range' using errcode = '22023';
  end if;
  -- Dimensions are optional on a lead (the visitor may bail before choosing),
  -- but if present they must be values the calculator could actually produce.
  if p_bedrooms is not null or p_dwelling_type is not null then
    perform public.assert_dims(p_bedrooms, p_dwelling_type);
  end if;

  insert into public.leads (
    name, email, phone, place_id, formatted_address, bedrooms, dwelling_type,
    scenario, current_weekly_rent, estimate, projection
  )
  values (
    btrim(p_name), lower(btrim(p_email)), p_phone, p_place_id, p_formatted_address,
    p_bedrooms, p_dwelling_type, p_scenario, p_current_weekly_rent,
    p_estimate, p_projection
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

-- Stamps the notification email. Narrow on purpose: it can only ever set
-- emailed_at, and only on a lead that has not been stamped yet.
create or replace function public.mark_lead_emailed(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.leads
     set emailed_at = now()
   where id = p_id
     and emailed_at is null;
$fn$;

-- ---------------------------------------------------------------------------
-- The 1-month expiry.
--
-- NOTE: this job is a storage/housekeeping measure, NOT the correctness mechanism.
-- get_cached_estimate and get_locality_stats filter `expires_at > now()` in the
-- query itself, so an over-age row is never served even if this job is late,
-- fails, or is disabled.
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_cache()
returns void
language sql
security definer
set search_path = public
as $fn$
  delete from public.estimate_cache where expires_at < now();
  delete from public.locality_stats where expires_at < now();
$fn$;

-- ---------------------------------------------------------------------------
-- Execute grants. `security definer` alone would leave these callable by PUBLIC,
-- which is how a locked-down table gets quietly reopened — so revoke first, then
-- hand `anon` exactly the six the API needs. assert_dims, refresh_locality_stats
-- and purge_expired_cache stay internal.
-- ---------------------------------------------------------------------------
revoke all on function public.assert_dims(smallint, text) from public;
revoke all on function public.get_cached_estimate(text) from public;
revoke all on function public.bump_cache_hit(text) from public;
revoke all on function public.put_cached_estimate(text, text, text, text, text, smallint, text, jsonb, text, integer) from public;
revoke all on function public.get_locality_stats(text, smallint, text) from public;
revoke all on function public.refresh_locality_stats(text, text, smallint, text) from public;
revoke all on function public.insert_lead(text, text, text, text, text, smallint, text, text, numeric, jsonb, jsonb) from public;
revoke all on function public.mark_lead_emailed(uuid) from public;
revoke all on function public.purge_expired_cache() from public;

grant execute on function public.get_cached_estimate(text) to anon;
grant execute on function public.bump_cache_hit(text) to anon;
grant execute on function public.put_cached_estimate(text, text, text, text, text, smallint, text, jsonb, text, integer) to anon;
grant execute on function public.get_locality_stats(text, smallint, text) to anon;
grant execute on function public.insert_lead(text, text, text, text, text, smallint, text, text, numeric, jsonb, jsonb) to anon;
grant execute on function public.mark_lead_emailed(uuid) to anon;

-- ---------------------------------------------------------------------------
-- pg_cron is enabled by default on Supabase projects. Guarded so the migration is
-- re-runnable and so it degrades gracefully if the extension is unavailable.
-- ---------------------------------------------------------------------------
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-expired-cache')
      where exists (select 1 from cron.job where jobname = 'purge-expired-cache');

    perform cron.schedule(
      'purge-expired-cache',
      '15 3 * * *',
      $cron$select public.purge_expired_cache()$cron$
    );
  else
    raise notice 'pg_cron not installed; skipping purge schedule. Enable it under Database > Extensions, then re-run this migration.';
  end if;
end;
$do$;
