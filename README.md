# SmartHomes

Marketing site for SmartHomes NZ. Static Vite build plus a small serverless API
that powers the property income calculator in the hero.

## Running locally

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev                  # http://localhost:3000
```

`npm run dev` serves the `api/` functions too, via `vite-plugin-dev-api.js`, so the
calculator behaves the same locally as it does on Vercel.

> Editing anything under `api/_lib/` needs a dev-server restart — Node caches
> shared ES modules for the life of the process. Endpoint files reload on their
> own. The dev server prints a warning when this applies.

## The calculator

`/api/estimate` is the only endpoint that costs money per call, so it is cache-first:

1. Look up `sha256(placeId + bedrooms + dwellingType)` in the Supabase
   `estimate_cache` table, filtered on `expires_at > now()`.
2. On a miss, read the `locality_stats` rollup for that suburb and pass it to the
   model as grounding, so neighbouring properties don't drift apart.
3. Ask OpenAI, with the `web_search` tool, for the long-term market rent plus the
   short-stay nightly rate and occupancy.
4. Validate the response against the bounds in `api/_lib/config.js`. Anything
   implausible is rejected rather than shown.
5. Cache the validated result for one month and fold it into the suburb rollup.

If OpenAI fails or returns something implausible, the suburb rollup is served
instead and the UI labels it as a suburb-level estimate. Failures and fallbacks
are never cached.

The `scenario` (currently rented / new) is deliberately **not** part of the cache
key — the two tabs differ only in presentation, so switching between them is free.

### What a call costs

On `gpt-4.1-mini`, one fresh estimate is roughly **1.4 US cents**:

| | |
|---|---|
| `web_search` tool call | $0.0100 ($10 / 1k calls) |
| search content (billed as a fixed 8k input block on this model) | $0.0032 |
| our prompt (~400 input tokens) | $0.0002 |
| JSON response (~200 output tokens) | $0.0003 |
| **per fresh estimate** | **~$0.0137** |

If the single-call strategy fails validation and the two-step fallback runs, the
worst case is about **2.9 cents** (two search calls plus a tool-less extraction).

Cache hits cost nothing, and each property is only paid for once a month, so spend
tracks *unique addresses*, not page views. Watch the `hits` column on
`estimate_cache` to see how much the cache is actually saving.

### Cache expiry

The one-month TTL is enforced by the `expires_at > now()` predicate on every read.
The nightly `pg_cron` job in the migration only reclaims storage; if it is late,
fails, or is disabled, an over-age row still will not be served.

## Database

Apply `supabase/migrations/0001_estimate_cache.sql` with the Supabase CLI
(`supabase db push`) or by pasting it into the SQL editor. It creates
`estimate_cache`, `locality_stats` and `leads`, enables RLS with **no policies**,
revokes the table grants from `anon`/`authenticated`, and schedules the purge job.

`api/` connects with the **anon key**, not the service role key, so it has no
direct access to those tables either. Every read and write goes through a
`security definer` function that validates its own input, and only six of them
are granted to `anon`: `get_cached_estimate`, `bump_cache_hit`,
`put_cached_estimate`, `get_locality_stats`, `insert_lead` and
`mark_lead_emailed`. There is deliberately no way to list or read back leads.
Treat the anon key as public: if it leaks, the exposure is RPC abuse subject to
the same validation, not a database dump.

Leads are business records and are excluded from the purge.

## Environment

See `.env.example`. None of these are `VITE_`-prefixed and none may be exposed to
the browser. Each endpoint returns a clean `503 not_configured` when its key is
missing, and the UI degrades to a readable message.

| Variable | Used for |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Places autocomplete + details |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | The estimate. Defaults to `gpt-4.1-mini` (see `api/_lib/config.js`). Any override must support both the Responses API `web_search` tool and strict structured outputs. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Cache and leads |
| `RESEND_API_KEY`, `LEAD_TO_EMAIL`, `LEAD_FROM_EMAIL` | Lead notification email |

## Deploying

Vercel, zero-config: the Vite output is served statically and `api/**` is deployed
as Node functions. Set the environment variables in the project settings.

## Layout

```
api/            serverless functions (never bundled into the browser)
  _lib/         shared config, HTTP wrapper, Supabase client, cache, model call
  places/       Google Places proxies
index.html      the whole site, including the calculator markup
app.js          calculator + site interactions
styles.css
scrub-engine.js scroll-driven background video
supabase/       database migration
```
