-- SmartHomes: cache hardening.
--
-- 0001 built a two-tier cache but only the exact tier could ever prevent an OpenAI
-- call, and that tier is keyed on a specific Google place id — so a public calculator
-- where every visitor types a new address hits it almost never. This migration makes
-- the suburb tier able to *answer*, and puts real ceilings around the paid path.
--
-- Five changes:
--   1. locality_stats is keyed on BUCKETS (5+ bedrooms collapse, flat == apartment)
--      so far fewer partitions need warming before a suburb can serve.
--   2. estimate_failures  — negative cache, so a retry on a bad address is free.
--   3. rate_limits        — global fixed-window limiter. The Map in handler.js is
--                           per-instance, which on Vercel means per cold start.
--   4. model_budget       — hard site-wide daily ceiling on billed model calls.
--   5. estimate_inflight  — single-flight, so concurrent misses on one key buy one call.
--
-- Same access model as 0001: RLS on, no policies, no grants; `anon` reaches these
-- only through the security definer RPCs granted at the bottom.

-- ---------------------------------------------------------------------------
-- 1. Bucketing.
--
-- The bucket rules are duplicated in the expression index below and in the two
-- rollup functions. They MUST stay in step — a mismatch silently stops the index
-- being used rather than returning wrong rows. They are deliberately not a helper
-- function: a generated/indexed expression pins the function definition and makes
-- the rule harder to change later, not easier.
--
--   bedrooms      -> least(bedrooms, 5)   6/7/8-bed properties are rare and behave
--                                         like 5-bed for rollup purposes.
--   dwelling_type -> flat => apartment    The NZ rental market prices these together.
--
-- NOTE this applies to the SUBURB tier only. estimate_cache.cache_key stays exact:
-- tier 1 is a per-address answer and must not be blurred.
-- ---------------------------------------------------------------------------

create index if not exists estimate_cache_locality_bucket_idx
  on public.estimate_cache (
    locality,
    (least(bedrooms, 5)),
    ((case when dwelling_type = 'flat' then 'apartment' else dwelling_type end))
  );

-- Rename the rollup's key columns so they can't be read as exact values.
-- locality_stats is purely derived, so it is safe to rebuild from scratch below.
do $do$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'locality_stats'
       and column_name = 'bedrooms'
  ) then
    alter table public.locality_stats rename column bedrooms      to bedrooms_bucket;
    alter table public.locality_stats rename column dwelling_type to dwelling_bucket;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- 2. Negative cache. A model failure or an out-of-bounds payload currently costs
-- full price on every retry, and the UI has a retry button. TTL is short (minutes,
-- not days) because the cause is usually transient.
--
-- Deliberately a separate table rather than a nullable payload on estimate_cache:
-- put_cached_estimate's `not null` + plausibility checks are the reason a bad number
-- can never be served, and loosening them to hold failures would give that up.
-- ---------------------------------------------------------------------------
create table if not exists public.estimate_failures (
  cache_key  text primary key,
  reason     text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour'
);

create index if not exists estimate_failures_expires_at_idx
  on public.estimate_failures (expires_at);

-- ---------------------------------------------------------------------------
-- 3. Global rate limiter. One row per bucket ("estimate:1.2.3.4"), fixed window.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  bucket       text primary key,
  window_start timestamptz not null default now(),
  hits         integer     not null default 0
);

create index if not exists rate_limits_window_start_idx
  on public.rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- 4. Daily model budget. The backstop that makes runaway spend impossible rather
-- than merely unlikely: one row per UTC day, incremented before each billed call.
-- ---------------------------------------------------------------------------
create table if not exists public.model_budget (
  day   date    primary key,
  calls integer not null default 0
);

-- ---------------------------------------------------------------------------
-- 5. Single-flight. Without this, N concurrent misses on one cold key buy N calls.
-- expires_at is a lease, not a lock: a function that dies mid-call must not wedge
-- the key until someone notices.
-- ---------------------------------------------------------------------------
create table if not exists public.estimate_inflight (
  cache_key  text primary key,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists estimate_inflight_expires_at_idx
  on public.estimate_inflight (expires_at);

alter table public.estimate_failures enable row level security;
alter table public.rate_limits       enable row level security;
alter table public.model_budget      enable row level security;
alter table public.estimate_inflight enable row level security;

revoke all on public.estimate_failures from anon, authenticated;
revoke all on public.rate_limits       from anon, authenticated;
revoke all on public.model_budget      from anon, authenticated;
revoke all on public.estimate_inflight from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rollup recompute, now bucketed. Callers still pass the property's real bedrooms
-- and dwelling type; the bucketing happens here so there is exactly one place that
-- knows the rule on the read and write side both.
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
declare
  v_beds     smallint := least(p_bedrooms, 5);
  v_dwelling text     := case when p_dwelling_type = 'flat' then 'apartment'
                             else p_dwelling_type end;
begin
  insert into public.locality_stats as ls (
    locality, region, bedrooms_bucket, dwelling_bucket,
    weekly_rent, nightly_rate, occupancy, sample_size,
    updated_at, expires_at
  )
  select
    p_locality,
    p_region,
    v_beds,
    v_dwelling,
    percentile_cont(0.5) within group (order by (payload->>'weeklyMarketRent')::numeric),
    percentile_cont(0.5) within group (order by (payload->>'nightlyRate')::numeric),
    percentile_cont(0.5) within group (order by (payload->>'occupancy')::numeric),
    count(*),
    now(),
    now() + interval '1 month'
  from public.estimate_cache
  where locality = p_locality
    and least(bedrooms, 5) = v_beds
    and (case when dwelling_type = 'flat' then 'apartment' else dwelling_type end) = v_dwelling
    and expires_at > now()
  having count(*) > 0
  on conflict (locality, bedrooms_bucket, dwelling_bucket) do update
    set region       = excluded.region,
        weekly_rent  = excluded.weekly_rent,
        nightly_rate = excluded.nightly_rate,
        occupancy    = excluded.occupancy,
        sample_size  = excluded.sample_size,
        updated_at   = excluded.updated_at,
        expires_at   = excluded.expires_at;
end;
$fn$;

-- Suburb rollup read. Signature unchanged, so the API keeps passing real values.
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
   where s.locality        = p_locality
     and s.bedrooms_bucket = least(p_bedrooms, 5)
     and s.dwelling_bucket = case when p_dwelling_type = 'flat' then 'apartment'
                                 else p_dwelling_type end
     and s.expires_at      > now();
$fn$;

-- Rebuild the rollup under the new bucket keys. Safe at any time: every row here is
-- derived from estimate_cache, and only validated first-party model output ever
-- reaches estimate_cache. A suburb-served answer is never written back, so this
-- cannot fold the rollup's own output into its next median.
truncate table public.locality_stats;

insert into public.locality_stats (
  locality, region, bedrooms_bucket, dwelling_bucket,
  weekly_rent, nightly_rate, occupancy, sample_size, updated_at, expires_at
)
select
  locality,
  min(region),
  least(bedrooms, 5),
  case when dwelling_type = 'flat' then 'apartment' else dwelling_type end,
  percentile_cont(0.5) within group (order by (payload->>'weeklyMarketRent')::numeric),
  percentile_cont(0.5) within group (order by (payload->>'nightlyRate')::numeric),
  percentile_cont(0.5) within group (order by (payload->>'occupancy')::numeric),
  count(*),
  now(),
  now() + interval '1 month'
from public.estimate_cache
where locality is not null
  and expires_at > now()
group by locality, least(bedrooms, 5),
         case when dwelling_type = 'flat' then 'apartment' else dwelling_type end;

-- ---------------------------------------------------------------------------
-- Negative cache RPCs. The read filters on expiry the same way the positive tier
-- does, so a stale failure is never honoured even if the purge job is behind.
-- ---------------------------------------------------------------------------
create or replace function public.get_estimate_failure(p_cache_key text)
returns table (reason text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $fn$
  select f.reason, f.created_at
    from public.estimate_failures f
   where f.cache_key = p_cache_key
     and f.expires_at > now();
$fn$;

create or replace function public.put_estimate_failure(
  p_cache_key   text,
  p_reason      text,
  p_ttl_minutes integer default 60
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_cache_key !~ '^[0-9a-f]{64}$' then
    raise exception 'malformed cache_key' using errcode = '22023';
  end if;
  if p_ttl_minutes is null or p_ttl_minutes < 1 or p_ttl_minutes > 1440 then
    raise exception 'ttl_minutes out of range: %', p_ttl_minutes using errcode = '22023';
  end if;

  insert into public.estimate_failures (cache_key, reason, created_at, expires_at)
  values (
    p_cache_key,
    left(coalesce(p_reason, ''), 300),
    now(),
    now() + make_interval(mins => p_ttl_minutes)
  )
  on conflict (cache_key) do update
    set reason     = excluded.reason,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Global fixed-window rate limit. Returns true when the caller may proceed.
--
-- The whole decision is one upsert, so concurrent requests cannot both read an
-- under-limit count and then both write it back.
-- ---------------------------------------------------------------------------
create or replace function public.check_rate_limit(
  p_bucket         text,
  p_max            integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hits integer;
begin
  if p_bucket is null or length(p_bucket) not between 1 and 200 then
    raise exception 'invalid bucket' using errcode = '22023';
  end if;
  if p_max is null or p_max < 1 or p_max > 100000 then
    raise exception 'max out of range: %', p_max using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'window out of range: %', p_window_seconds using errcode = '22023';
  end if;

  insert into public.rate_limits as rl (bucket, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
    set hits = case
                 when rl.window_start < now() - make_interval(secs => p_window_seconds)
                 then 1
                 else rl.hits + 1
               end,
        window_start = case
                 when rl.window_start < now() - make_interval(secs => p_window_seconds)
                 then now()
                 else rl.window_start
               end
  returning rl.hits into v_hits;

  return v_hits <= p_max;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Daily billed-call budget. Returns true only if this call fits under the cap.
--
-- The conditional UPDATE is what makes the cap exact: a denied attempt never
-- increments, so the counter stays a true count of calls made, not calls tried.
-- ---------------------------------------------------------------------------
create or replace function public.try_consume_model_call(p_max_per_day integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_calls integer;
begin
  if p_max_per_day is null or p_max_per_day < 0 or p_max_per_day > 1000000 then
    raise exception 'budget out of range: %', p_max_per_day using errcode = '22023';
  end if;

  insert into public.model_budget (day, calls)
  values (current_date, 0)
  on conflict (day) do nothing;

  update public.model_budget
     set calls = calls + 1
   where day = current_date
     and calls < p_max_per_day
  returning calls into v_calls;

  return v_calls is not null;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Single-flight. True means this caller owns the key and should make the call.
--
-- A lease rather than a lock: an advisory lock is released the moment this
-- security definer function returns, which is long before the model call it is
-- meant to guard finishes. The row's expires_at outlives the request instead.
-- ---------------------------------------------------------------------------
create or replace function public.try_begin_estimate(
  p_cache_key   text,
  p_ttl_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rows integer;
begin
  if p_cache_key !~ '^[0-9a-f]{64}$' then
    raise exception 'malformed cache_key' using errcode = '22023';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 600 then
    raise exception 'ttl_seconds out of range: %', p_ttl_seconds using errcode = '22023';
  end if;

  -- Reclaim abandoned leases before contending, so one crashed request cannot
  -- block a key for longer than its lease.
  delete from public.estimate_inflight where expires_at < now();

  insert into public.estimate_inflight (cache_key, started_at, expires_at)
  values (p_cache_key, now(), now() + make_interval(secs => p_ttl_seconds))
  on conflict (cache_key) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$fn$;

create or replace function public.end_estimate(p_cache_key text)
returns void
language sql
security definer
set search_path = public
as $fn$
  delete from public.estimate_inflight where cache_key = p_cache_key;
$fn$;

-- ---------------------------------------------------------------------------
-- Housekeeping. Extends the 0001 purge to the new tables. Same standing caveat:
-- every read filters on expiry itself, so this only reclaims storage.
--
-- rate_limits and estimate_inflight are swept aggressively because they churn;
-- model_budget keeps a fortnight so spend stays auditable after the fact.
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_cache()
returns void
language sql
security definer
set search_path = public
as $fn$
  delete from public.estimate_cache    where expires_at < now();
  delete from public.locality_stats    where expires_at < now();
  delete from public.estimate_failures where expires_at < now();
  delete from public.estimate_inflight where expires_at < now();
  delete from public.rate_limits       where window_start < now() - interval '1 day';
  delete from public.model_budget      where day < current_date - 14;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants. Revoke from PUBLIC first, then hand `anon` exactly what api/ calls.
--
-- There is deliberately no "give the budget back" RPC. Anything granted here is
-- callable by anyone holding the anon key, and a decrement is all it would take to
-- hold the counter at zero and defeat the daily cap entirely. The budget only ever
-- goes up, and only through the conditional update in try_consume_model_call.
-- ---------------------------------------------------------------------------
revoke all on function public.get_estimate_failure(text) from public;
revoke all on function public.put_estimate_failure(text, text, integer) from public;
revoke all on function public.check_rate_limit(text, integer, integer) from public;
revoke all on function public.try_consume_model_call(integer) from public;
revoke all on function public.try_begin_estimate(text, integer) from public;
revoke all on function public.end_estimate(text) from public;

grant execute on function public.get_estimate_failure(text) to anon;
grant execute on function public.put_estimate_failure(text, text, integer) to anon;
grant execute on function public.check_rate_limit(text, integer, integer) to anon;
grant execute on function public.try_consume_model_call(integer) to anon;
grant execute on function public.try_begin_estimate(text, integer) to anon;
grant execute on function public.end_estimate(text) to anon;
