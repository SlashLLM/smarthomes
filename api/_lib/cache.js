/* Supabase-backed estimate cache.
 *
 * Read path:  cacheKey -> estimate_cache WHERE expires_at > now()
 * Miss path:  locality_stats (grounding for the prompt, and the fallback if
 *             OpenAI fails) -> OpenAI -> write back both tiers.
 *
 * Everything goes through `security definer` RPCs rather than the tables: the
 * client here holds the anon key, and the tables are RLS-denied to `anon`. The
 * `expires_at > now()` predicate lives inside get_cached_estimate /
 * get_locality_stats and is what actually enforces the one-month TTL — the
 * pg_cron job in the migration only reclaims storage.
 */

import { createHash } from "node:crypto";
import { getSupabase } from "./supabase.js";
import {
  CACHE_TTL_DAYS,
  NEGATIVE_CACHE_TTL_MINUTES,
  INFLIGHT_LEASE_SECONDS,
  MODEL_DAILY_BUDGET,
} from "./config.js";

/** Stable cache key. Normalised so casing or stray whitespace can't fork it.
 *  Deliberately excludes `scenario` — the two tabs are presentation only, so
 *  toggling between them on the same property must not cost a second call. */
export function cacheKey({ placeId, bedrooms, dwellingType }) {
  const raw = [
    String(placeId).trim(),
    String(bedrooms).trim(),
    String(dwellingType).trim().toLowerCase(),
  ].join("|");
  return createHash("sha256").update(raw).digest("hex");
}

export async function readCache(key) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .rpc("get_cached_estimate", { p_cache_key: key })
    .maybeSingle();

  if (error) {
    // A cache failure must never break the calculator — degrade to a live call.
    console.error("[cache] read failed:", error.message);
    return null;
  }
  if (!data) return null;

  // Fire and forget; the user should not wait on a counter.
  db.rpc("bump_cache_hit", { p_cache_key: key }).then(
    () => {},
    (e) => console.error("[cache] hit counter failed:", e?.message)
  );

  return { payload: data.payload, model: data.model, cachedAt: data.created_at };
}

export async function writeCache(key, place, dims, payload, model) {
  const db = getSupabase();
  if (!db) return;

  // One call: the RPC validates the payload, upserts, and rolls the result into
  // the suburb tier itself. Best-effort — a write failure costs a cache entry,
  // not the response we already have.
  const { error } = await db.rpc("put_cached_estimate", {
    p_cache_key: key,
    p_place_id: place.placeId,
    p_formatted_address: place.formattedAddress,
    p_locality: place.locality || null,
    p_region: place.region || null,
    p_bedrooms: dims.bedrooms,
    p_dwelling_type: dims.dwellingType,
    p_payload: payload,
    p_model: model ?? null,
    p_ttl_days: CACHE_TTL_DAYS,
  });

  if (error) console.error("[cache] write failed:", error.message);
}

/** Suburb-level stats: prompt grounding on the happy path, fallback on failure. */
export async function readLocalityStats({ locality, bedrooms, dwellingType }) {
  const db = getSupabase();
  if (!db || !locality) return null;

  const { data, error } = await db
    .rpc("get_locality_stats", {
      p_locality: locality,
      p_bedrooms: bedrooms,
      p_dwelling_type: dwellingType,
    })
    .maybeSingle();

  if (error) {
    console.error("[cache] locality read failed:", error.message);
    return null;
  }
  if (!data || !data.weekly_rent) return null;

  return {
    weeklyMarketRent: Number(data.weekly_rent),
    nightlyRate: Number(data.nightly_rate),
    occupancy: Number(data.occupancy),
    sampleSize: data.sample_size,
    updatedAt: data.updated_at,
  };
}

/* -------------------------------------------------------------------------
 * Negative cache.
 *
 * Failures deliberately never touch estimate_cache: that table's `not null` and
 * plausibility checks are the reason a bad number can't be served, and widening
 * them to hold failures would give that up. A separate short-TTL table instead.
 * ------------------------------------------------------------------------- */

/** @returns {Promise<{reason: string, failedAt: string} | null>} */
export async function readFailure(key) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .rpc("get_estimate_failure", { p_cache_key: key })
    .maybeSingle();

  if (error) {
    console.error("[cache] failure read failed:", error.message);
    return null;
  }
  return data ? { reason: data.reason, failedAt: data.created_at } : null;
}

export async function writeFailure(key, reason) {
  const db = getSupabase();
  if (!db) return;

  const { error } = await db.rpc("put_estimate_failure", {
    p_cache_key: key,
    p_reason: String(reason || "unknown").slice(0, 300),
    p_ttl_minutes: NEGATIVE_CACHE_TTL_MINUTES,
  });

  if (error) console.error("[cache] failure write failed:", error.message);
}

/* -------------------------------------------------------------------------
 * Single-flight.
 *
 * Without this, N concurrent misses on one cold key buy N identical calls. The
 * winner makes the call and writes the cache; the losers wait for that row.
 * ------------------------------------------------------------------------- */

/** @returns {Promise<boolean>} true when this caller owns the key.
 *  Fails OPEN: with Supabase down we'd rather bill a duplicate call than refuse
 *  to answer, which is the same stance every other path in this file takes. */
export async function beginEstimate(key) {
  const db = getSupabase();
  if (!db) return true;

  const { data, error } = await db.rpc("try_begin_estimate", {
    p_cache_key: key,
    p_ttl_seconds: INFLIGHT_LEASE_SECONDS,
  });

  if (error) {
    console.error("[cache] inflight claim failed:", error.message);
    return true;
  }
  return data === true;
}

export async function endEstimate(key) {
  const db = getSupabase();
  if (!db) return;

  const { error } = await db.rpc("end_estimate", { p_cache_key: key });
  // The lease expires on its own, so a failed release costs latency on the next
  // miss for this key, nothing more.
  if (error) console.error("[cache] inflight release failed:", error.message);
}

/* -------------------------------------------------------------------------
 * Daily spend ceiling.
 * ------------------------------------------------------------------------- */

/** Claim one billed call against today's budget.
 *  @returns {Promise<boolean>} false when the cap is reached.
 *
 *  Fails OPEN for the same reason as beginEstimate: a Supabase outage must not
 *  take the calculator down. The per-instance limiter in handler.js is still
 *  standing in that case. */
export async function consumeModelCall() {
  const db = getSupabase();
  if (!db) return true;

  const { data, error } = await db.rpc("try_consume_model_call", {
    p_max_per_day: MODEL_DAILY_BUDGET,
  });

  if (error) {
    console.error("[cache] budget check failed:", error.message);
    return true;
  }
  return data === true;
}

/* -------------------------------------------------------------------------
 * Global rate limit.
 * ------------------------------------------------------------------------- */

/** @returns {Promise<boolean>} true when the caller may proceed. Fails open. */
export async function checkRateLimit(bucket, max, windowMs) {
  const db = getSupabase();
  if (!db) return true;

  const { data, error } = await db.rpc("check_rate_limit", {
    p_bucket: bucket.slice(0, 200),
    p_max: max,
    p_window_seconds: Math.max(1, Math.round(windowMs / 1000)),
  });

  if (error) {
    console.error("[cache] rate limit check failed:", error.message);
    return true;
  }
  return data === true;
}
