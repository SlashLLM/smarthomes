/* Cache-first property income estimate.
 *
 *   exact cache hit   -> return immediately, no model call
 *   known-bad address -> suburb answer or an honest error, no model call
 *   warm suburb       -> suburb answer, no model call
 *   otherwise         -> single-flight -> budget -> OpenAI -> validate -> cache
 *   failure           -> remember the failure, fall back to the suburb tier
 *
 * The order matters: every step above the model call is a step that can end the
 * request without spending money, cheapest first.
 *
 * Only validated first-party results are ever written to the exact cache, and a
 * suburb answer is never written back at all — so the rollup can never fold its
 * own output into its next median. That invariant is what makes it safe to serve
 * the suburb tier rather than only fall back to it.
 */

import { createHandler, ApiError } from "./_lib/handler.js";
import {
  cacheKey,
  readCache,
  writeCache,
  readLocalityStats,
  readFailure,
  writeFailure,
  beginEstimate,
  endEstimate,
  consumeModelCall,
  checkRateLimit,
} from "./_lib/cache.js";
import { requestEstimate } from "./_lib/openai-estimate.js";
import {
  RATE_LIMIT,
  DWELLING_TYPES,
  BEDROOM_RANGE,
  LOCALITY_SERVE,
} from "./_lib/config.js";

const REQUEST_TIMEOUT_MS = 45_000;

// How long a request that lost the single-flight race waits for the winner's
// result before giving up and answering from the suburb tier. Well under the
// winner's own timeout: a loser should degrade, not sit on a function slot.
const WAIT_FOR_WINNER_MS = 12_000;
const WAIT_POLL_MS = 750;

function parseInputs(body) {
  const placeId = String(body.placeId || "").trim();
  if (!placeId) {
    // Guards the expensive path: a free-text address alone can't reach OpenAI.
    throw new ApiError(400, "bad_request", "Select an address from the suggestions.");
  }

  const bedrooms = Math.round(Number(body.bedrooms));
  if (!Number.isFinite(bedrooms) || bedrooms < BEDROOM_RANGE.min || bedrooms > BEDROOM_RANGE.max) {
    throw new ApiError(
      400,
      "bad_request",
      `Bedrooms must be between ${BEDROOM_RANGE.min} and ${BEDROOM_RANGE.max}.`
    );
  }

  const dwellingType = String(body.dwellingType || "house").trim().toLowerCase();
  if (!DWELLING_TYPES.includes(dwellingType)) {
    throw new ApiError(400, "bad_request", "Unknown dwelling type.");
  }

  return {
    place: {
      placeId,
      formattedAddress: String(body.formattedAddress || "").trim(),
      locality: body.locality ? String(body.locality).trim() : null,
      city: body.city ? String(body.city).trim() : null,
      region: body.region ? String(body.region).trim() : null,
    },
    bedrooms,
    dwellingType,
    forceRefresh: body.forceRefresh === true,
  };
}

/** Poll for the single-flight winner's write. Returns the payload or null. */
async function waitForWinner(key) {
  const deadline = Date.now() + WAIT_FOR_WINNER_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
    const hit = await readCache(key);
    if (hit) return hit;
  }
  return null;
}

export default createHandler(
  async ({ body, ip }) => {
    const { place, bedrooms, dwellingType, ...opts } = parseInputs(body);
    let forceRefresh = opts.forceRefresh;
    const key = cacheKey({ placeId: place.placeId, bedrooms, dwellingType });

    /* forceRefresh comes straight off the request body — it is the rescan button,
     * but nothing stops anyone POSTing it in a loop, and it bypasses every cache
     * we have. It gets its own tight global budget on top of the endpoint's.
     *
     * A denial is not an error. Dropping back to the cached answer and telling the
     * UI why is far better than a 429 on a button the user is allowed to press. */
    let refreshDenied = false;
    if (forceRefresh) {
      const allowed = await checkRateLimit(
        `estimate:refresh:${ip}`,
        RATE_LIMIT.estimateRefresh.max,
        RATE_LIMIT.estimateRefresh.windowMs
      );
      if (!allowed) {
        forceRefresh = false;
        refreshDenied = true;
      }
    }

    if (!forceRefresh) {
      const hit = await readCache(key);
      if (hit) {
        return {
          ...hit.payload,
          source: "cache",
          cached: true,
          cachedAt: hit.cachedAt,
          refreshDenied,
        };
      }
    }

    // Grounding for the prompt, the serving tier below, and the fallback on every
    // failure path — so it is read once, before any of them.
    const grounding = await readLocalityStats({
      locality: place.locality,
      bedrooms,
      dwellingType,
    });

    if (!forceRefresh) {
      /* Negative cache. A model failure is usually transient, but the UI offers a
       * retry and users use it — without this, every click re-bills the same
       * broken address. */
      const failure = await readFailure(key);
      if (failure) {
        if (grounding) return localityResponse(grounding, { refreshDenied });
        throw new ApiError(
          502,
          "estimate_failed",
          "We couldn't analyse that address just now. Please try again shortly."
        );
      }

      /* The suburb tier answering on its own — the change that actually moves
       * spend. Once a (suburb, bedroom bucket, dwelling bucket) partition holds
       * enough real analyses, every further property in it is free. Below the
       * threshold the median rests on too few comparables to stand behind, so we
       * pay for a live analysis instead. */
      if (grounding && grounding.sampleSize >= LOCALITY_SERVE.minSample) {
        return localityResponse(grounding, { refreshDenied });
      }
    }

    if (!process.env.OPENAI_API_KEY) {
      if (grounding) return localityResponse(grounding, { refreshDenied });
      throw new ApiError(
        503,
        "not_configured",
        "The estimate service is not configured yet."
      );
    }

    /* Single-flight. Without it, N concurrent misses on one cold key buy N
     * identical calls — a shared link is enough to trigger that. Claimed before
     * the budget so a loser never touches the counter. */
    const owns = await beginEstimate(key);
    if (!owns) {
      const waited = await waitForWinner(key);
      if (waited) {
        return {
          ...waited.payload,
          source: "cache",
          cached: true,
          cachedAt: waited.cachedAt,
          refreshDenied,
        };
      }
      if (grounding) return localityResponse(grounding, { refreshDenied });
      throw new ApiError(
        502,
        "estimate_failed",
        "That address is being analysed right now. Please try again in a moment."
      );
    }

    let result = null;
    let budgetExhausted = false;
    let reason = "payload failed validation";

    try {
      /* Hard daily ceiling on billed calls. Past it the calculator keeps working
       * on cached and suburb answers rather than going dark. */
      if (!(await consumeModelCall())) {
        budgetExhausted = true;
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          result = await requestEstimate({
            place,
            bedrooms,
            dwellingType,
            grounding,
            signal: controller.signal,
          });
        } catch (err) {
          console.error("[estimate] model call failed:", err?.message);
          reason = err?.message || "model call threw";
        } finally {
          clearTimeout(timer);
        }

        /* One failure row per attempt, covering both a thrown call and a
         * well-formed one whose payload validate() rejected — a retry on either
         * would fail the same way and bill again.
         *
         * Budget is deliberately NOT handed back here: an aborted or rejected call
         * may well have billed, and over-counting is the safe direction for a
         * spend ceiling. */
        if (!result) await writeFailure(key, reason);
      }
    } finally {
      await endEstimate(key);
    }

    if (!result) {
      if (grounding) return localityResponse(grounding, { refreshDenied, budgetExhausted });
      throw new ApiError(
        budgetExhausted ? 503 : 502,
        budgetExhausted ? "budget_exhausted" : "estimate_failed",
        budgetExhausted
          ? "We've hit today's analysis limit. Please try again tomorrow."
          : "We couldn't analyse that address just now. Please try again."
      );
    }

    // Write-back is best effort — never make the user wait on it or fail on it.
    await writeCache(
      key,
      place,
      { bedrooms, dwellingType },
      result.estimate,
      result.model
    );

    return {
      ...result.estimate,
      source: "live",
      cached: false,
      cachedAt: new Date().toISOString(),
      refreshDenied,
    };
  },
  { method: "POST", name: "estimate", rateLimit: RATE_LIMIT.estimate }
);

/** Suburb-level answer. Served deliberately once a suburb is warm, and as the
 *  fallback whenever the live path can't run. Flagged as such either way so the
 *  UI can say plainly that this is a suburb estimate, not an address analysis. */
function localityResponse(grounding, flags = {}) {
  return {
    weeklyMarketRent: Math.round(grounding.weeklyMarketRent),
    nightlyRate: Math.round(grounding.nightlyRate),
    occupancy: grounding.occupancy,
    // Suburb medians are inherently less certain than a per-address analysis.
    confidence: Math.min(70, 45 + grounding.sampleSize * 5),
    comparablesFound: grounding.sampleSize,
    sources: [],
    rationale:
      "Based on recent analyses of similar properties in this suburb rather than a live search of this specific address.",
    source: "locality",
    cached: false,
    cachedAt: grounding.updatedAt,
    refreshDenied: flags.refreshDenied === true,
    ...(flags.budgetExhausted ? { budgetExhausted: true } : {}),
  };
}
