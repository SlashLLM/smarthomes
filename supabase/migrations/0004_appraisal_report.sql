-- Appraisal report inputs, edited in the admin portal before generating the PDF.
--
-- Every column is an OVERRIDE: null means "use what the calculator produced"
-- (leads.estimate / leads.current_weekly_rent, or the CALC default for costs).
-- Assessment leads carry no estimate at all, so for those the admin fills these
-- in by hand before a report can be generated.
--
-- Read and written only by api/admin/* with the service role key; nothing here
-- is granted to anon.

alter table public.leads
  add column if not exists report_weekly_rent  numeric(10,2),
  add column if not exists report_nightly_rate numeric(10,2),
  add column if not exists report_occupancy    numeric(4,3),   -- fraction, 0.650 = 65%
  add column if not exists report_costs_pct    numeric(5,2),   -- % of gross short-stay revenue
  add column if not exists report_commentary   text,
  add column if not exists report_generated_at timestamptz;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_report_weekly_rent_check') then
    alter table public.leads add constraint leads_report_weekly_rent_check
      check (report_weekly_rent is null or report_weekly_rent between 50 and 10000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_report_nightly_rate_check') then
    alter table public.leads add constraint leads_report_nightly_rate_check
      check (report_nightly_rate is null or report_nightly_rate between 20 and 10000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_report_occupancy_check') then
    alter table public.leads add constraint leads_report_occupancy_check
      check (report_occupancy is null or report_occupancy between 0.05 and 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_report_costs_pct_check') then
    alter table public.leads add constraint leads_report_costs_pct_check
      check (report_costs_pct is null or report_costs_pct between 0 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_report_commentary_len_check') then
    alter table public.leads add constraint leads_report_commentary_len_check
      check (report_commentary is null or length(report_commentary) <= 2000);
  end if;
end;
$do$;
