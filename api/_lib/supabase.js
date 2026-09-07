/* Anon-key Supabase client.
 *
 * Deliberately NOT the service role key. Every table has RLS enabled with no
 * policies and no grants for `anon`, so this client cannot touch them directly —
 * it can only call the handful of `security definer` RPCs the migration grants to
 * `anon` (get_cached_estimate, bump_cache_hit, put_cached_estimate,
 * get_locality_stats, insert_lead, mark_lead_emailed), each of which validates
 * its own input. See supabase/migrations/0001_estimate_cache.sql.
 *
 * The key is still read from a non-VITE_ env var and used only from api/: there
 * is no reason for the browser to talk to Supabase. But because the anon key is a
 * public credential by design, a leak is a rate-limiting problem rather than a
 * database breach.
 */

import { createClient } from "@supabase/supabase-js";

let client;

/** @returns {import("@supabase/supabase-js").SupabaseClient | null} null when unconfigured. */
export function getSupabase() {
  if (client !== undefined) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Cache the negative so we don't re-check on every request. The calculator
    // still works without Supabase — it just loses caching and lead persistence.
    client = null;
    return client;
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "smarthomes-calculator" } },
  });
  return client;
}
