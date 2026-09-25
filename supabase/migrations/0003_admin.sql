-- Admin portal: lead pipeline columns, and insert_lead now stores source.
--
-- Access model for the admin portal: api/admin/* is gated by ADMIN_PASSWORD
-- (a signed session cookie) and reads/updates `leads` with the SERVICE ROLE key,
-- which bypasses RLS. Nothing here is granted to `anon` beyond what 0001 already
-- granted — the public endpoints still cannot read a lead back.

alter table public.leads
  add column if not exists source         text        not null default 'calculator',
  add column if not exists preferred_time text,
  add column if not exists status         text        not null default 'new',
  add column if not exists notes          text,
  add column if not exists updated_at     timestamptz not null default now();

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_status_check') then
    alter table public.leads add constraint leads_status_check
      check (status in ('new', 'contacted', 'report_sent', 'won', 'lost'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_source_check') then
    alter table public.leads add constraint leads_source_check
      check (source in ('calculator', 'assessment'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_notes_len_check') then
    alter table public.leads add constraint leads_notes_len_check
      check (notes is null or length(notes) <= 5000);
  end if;
end;
$do$;

create index if not exists leads_status_created_at_idx on public.leads (status, created_at desc);

-- ---------------------------------------------------------------------------
-- insert_lead gains p_source and p_preferred_time. Dropped and recreated rather
-- than overloaded: two insert_lead signatures with defaults make PostgREST's
-- named-argument resolution ambiguous. Both new params default to null, so the
-- old api/lead.js keeps working against this during a deploy.
-- ---------------------------------------------------------------------------
drop function if exists public.insert_lead(text, text, text, text, text, smallint, text, text, numeric, jsonb, jsonb);

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
  p_projection          jsonb    default null,
  p_source              text     default null,
  p_preferred_time      text     default null
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
     or coalesce(length(p_scenario), 0) > 40
     or coalesce(length(p_preferred_time), 0) > 60 then
    raise exception 'lead fields out of range' using errcode = '22023';
  end if;
  if p_source is not null and p_source not in ('calculator', 'assessment') then
    raise exception 'invalid source' using errcode = '22023';
  end if;
  -- Dimensions are optional on a lead (the visitor may bail before choosing),
  -- but if present they must be values the calculator could actually produce.
  if p_bedrooms is not null or p_dwelling_type is not null then
    perform public.assert_dims(p_bedrooms, p_dwelling_type);
  end if;

  insert into public.leads (
    name, email, phone, place_id, formatted_address, bedrooms, dwelling_type,
    scenario, current_weekly_rent, estimate, projection, source, preferred_time
  )
  values (
    btrim(p_name), lower(btrim(p_email)), p_phone, p_place_id, p_formatted_address,
    p_bedrooms, p_dwelling_type, p_scenario, p_current_weekly_rent,
    p_estimate, p_projection, coalesce(p_source, 'calculator'), p_preferred_time
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.insert_lead(text, text, text, text, text, smallint, text, text, numeric, jsonb, jsonb, text, text) from public;
grant execute on function public.insert_lead(text, text, text, text, text, smallint, text, text, numeric, jsonb, jsonb, text, text) to anon;
