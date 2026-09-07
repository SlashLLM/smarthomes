/* Calculator constants and model settings.
 *
 * These were previously bare literals scattered through app.js. They are the
 * commercial assumptions behind every number the hero card shows, so they live
 * in one place with an explanation of what each one means.
 */

/* Default OpenAI model. Override with OPENAI_MODEL.
 *
 * Must support the Responses API `web_search` tool AND strict structured outputs.
 * gpt-4.1-mini supports both.
 *
 * Cost per fresh estimate (gpt-4.1-mini, $0.40/1M in, $1.60/1M out):
 *   web_search tool call          $10.00 / 1k calls  = $0.0100
 *   search content (fixed 8k in)  8000 x $0.40/1M    = $0.0032
 *   our prompt (~400 in)                             = $0.0002
 *   JSON response (~200 out)                         = $0.0003
 *                                                    ~ $0.0137  (1.4 US cents)
 *
 * Note the tool fee dominates, so a cheaper model saves little — the Supabase
 * cache is what actually controls spend. Do NOT switch to `web_search_preview`:
 * on a non-reasoning model it costs $25/1k calls, nearly double, despite the
 * free content tokens.
 *
 * gpt-4.1-mini's training data ends June 2024, so the web_search grounding is
 * load-bearing here, not a nicety. When the search path fails entirely we fall
 * back to the locality rollup rather than the model's stale recollection.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

export const CALC = {
  // Share of gross short-stay revenue the owner actually keeps, after management
  // fee, cleaning, linen, platform commission and consumables. Was the unlabelled
  // `0.82` in the old app.js recalc().
  STR_NET_FACTOR: 0.82,

  // Nobody books out a whole year. Caps optimistic model output.
  MAX_OCCUPANCY: 0.92,

  // Year-on-year growth used for the 5-year projection.
  STR_GROWTH: 1.06,
  LTR_GROWTH: 1.025,
};

/* Note on the old `(0.9 + sleeps * 0.015)` size scalar in app.js: it is gone
 * rather than restated. Bedrooms and dwelling type are now sent to the model and
 * form part of the cache key, and locality_stats is keyed on both — so the
 * returned nightly rate already reflects them. Re-applying a size multiplier
 * client-side would double-count it. */

export const DWELLING_TYPES = ["house", "apartment", "flat"];

export const BEDROOM_RANGE = { min: 1, max: 8 };

/* Plausibility bounds for model output. Anything outside these is treated as a
 * bad response rather than rendered — a web-grounded model can still hallucinate,
 * and a wrong number on this card is a commercial promise. */
export const BOUNDS = {
  weeklyMarketRent: { min: 150, max: 5000 },   // NZD/wk
  nightlyRate: { min: 50, max: 3000 },         // NZD/night
  occupancy: { min: 0.3, max: 0.95 },
  // A nightly rate should sit somewhere in this band relative to weekly rent.
  // Catches unit-confusion (a weekly figure returned in the nightly field).
  nightlyToWeeklyRatio: { min: 0.1, max: 2.0 },
};

// How long a cached estimate is considered fresh. Mirrors the DEFAULT on
// estimate_cache.expires_at; kept here so the write path is explicit.
export const CACHE_TTL_DAYS = 30;

/* Per-IP request budget for the expensive endpoints.
 *
 * `global: true` sends the decision to Postgres (check_rate_limit) instead of the
 * per-instance Map in handler.js. That Map is per serverless instance, which on
 * Vercel means per cold start — fine as a cheap first line, useless as a ceiling.
 * Only the endpoints that can actually spend money pay for the extra round trip.
 */
export const RATE_LIMIT = {
  estimate: { max: 12, windowMs: 60 * 60 * 1000, global: true },
  /* Forced re-analysis always bills, so it gets its own much tighter budget on
   * top of the one above. No `global` flag: this one is checked directly in
   * api/estimate.js rather than by the handler, because a deny here is not an
   * error — the request falls back to the cached answer with `refreshDenied`
   * set, which a 429 from the handler could not express. */
  estimateRefresh: { max: 3, windowMs: 60 * 60 * 1000 },
  lead: { max: 6, windowMs: 60 * 60 * 1000, global: true },
  places: { max: 200, windowMs: 60 * 60 * 1000 },
};

/* When the suburb rollup may answer on its own instead of calling the model.
 *
 * This is the single biggest lever on OpenAI spend. The exact tier is keyed on a
 * Google place id, so on a public calculator — where nearly every visitor types an
 * address nobody has typed before — it almost never hits. The suburb tier is what
 * actually covers new traffic: once a `(suburb, bedroom bucket, dwelling bucket)`
 * partition holds enough real analyses, the next property in it is free.
 *
 * minSample is the honesty threshold. Below it the median rests on too few
 * comparables to stand behind, so we pay for a live analysis instead. Raising it
 * buys accuracy with spend; lowering it does the reverse.
 */
export const LOCALITY_SERVE = { minSample: 4 };

/* How long a failed analysis is remembered, in minutes.
 *
 * Short by design: the usual causes (a model timeout, a bad search minute) are
 * transient. Its job is to stop the retry button from re-billing the same broken
 * address, not to write an address off for the day.
 */
export const NEGATIVE_CACHE_TTL_MINUTES = 60;

/* Single-flight lease length. Comfortably longer than REQUEST_TIMEOUT_MS in
 * api/estimate.js so a lease cannot lapse while the call it guards is still live,
 * and short enough that a crashed function frees the key quickly. */
export const INFLIGHT_LEASE_SECONDS = 90;

/* Hard site-wide ceiling on billed model calls per UTC day. The backstop that
 * makes runaway spend impossible rather than merely unlikely — at the default and
 * ~1.4 US cents a call (see DEFAULT_OPENAI_MODEL above) the worst day costs about
 * US$3.50. Past the cap the calculator keeps working on cached and suburb answers.
 * Override with MODEL_DAILY_BUDGET. */
export const MODEL_DAILY_BUDGET = Number(process.env.MODEL_DAILY_BUDGET) || 250;
