/* Google Places Autocomplete (New), proxied so the API key stays server-side.
 *
 * The client generates a session token on the first keystroke and passes the same
 * token here on every request, then to /api/places/details on selection. That is
 * what keeps Places on session pricing instead of being billed per keystroke.
 */

import { createHandler, requireEnv, ApiError } from "../_lib/handler.js";
import { RATE_LIMIT } from "../_lib/config.js";

const ENDPOINT = "https://places.googleapis.com/v1/places:autocomplete";

export default createHandler(
  async ({ query }) => {
    // Cheap check first — a too-short query costs nothing and shouldn't surface
    // a configuration error.
    const input = (query.q || "").trim();
    if (input.length < 3) return { predictions: [] };

    const { GOOGLE_MAPS_API_KEY } = requireEnv("GOOGLE_MAPS_API_KEY");

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask":
          "suggestions.placePrediction.placeId," +
          "suggestions.placePrediction.structuredFormat",
      },
      body: JSON.stringify({
        input,
        includedRegionCodes: ["nz"],
        // Street addresses only — a calculator for a specific property has no use
        // for businesses, parks or whole cities.
        includedPrimaryTypes: ["street_address", "premise", "subpremise"],
        ...(query.session ? { sessionToken: query.session } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[places/autocomplete] Google error", res.status, detail);
      throw new ApiError(502, "places_failed", "Address lookup is unavailable.");
    }

    const data = await res.json();

    const predictions = (data.suggestions || [])
      .map((s) => s.placePrediction)
      .filter(Boolean)
      .map((p) => ({
        placeId: p.placeId,
        primary: p.structuredFormat?.mainText?.text || "",
        secondary: p.structuredFormat?.secondaryText?.text || "",
      }))
      .filter((p) => p.primary)
      .slice(0, 5);

    return { predictions };
  },
  { method: "GET", name: "places/autocomplete", rateLimit: RATE_LIMIT.places }
);
