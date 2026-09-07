/* Google Place Details (New).
 *
 * Called once when the user picks a prediction. Passing the same session token
 * used for autocomplete terminates the billing session.
 */

import { createHandler, requireEnv, ApiError } from "../_lib/handler.js";
import { RATE_LIMIT } from "../_lib/config.js";

/** Pull a named component out of the Places addressComponents array. */
function component(components, type) {
  const hit = (components || []).find((c) => (c.types || []).includes(type));
  return hit?.longText || hit?.shortText || null;
}

export default createHandler(
  async ({ query }) => {
    const { GOOGLE_MAPS_API_KEY } = requireEnv("GOOGLE_MAPS_API_KEY");

    const placeId = (query.placeId || "").trim();
    if (!placeId) {
      throw new ApiError(400, "bad_request", "placeId is required.");
    }

    const url = new URL(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`
    );
    if (query.session) url.searchParams.set("sessionToken", query.session);

    const res = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask":
          "id,formattedAddress,location,addressComponents,shortFormattedAddress",
      },
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[places/details] Google error", res.status, detail);
      throw new ApiError(502, "places_failed", "Could not resolve that address.");
    }

    const data = await res.json();
    const parts = data.addressComponents;

    return {
      place: {
        placeId: data.id || placeId,
        formattedAddress: data.formattedAddress || "",
        shortAddress: data.shortFormattedAddress || data.formattedAddress || "",
        // sublocality is the NZ suburb; locality is the town/city. Suburb first,
        // since that is the granularity rent actually varies at.
        locality:
          component(parts, "sublocality_level_1") ||
          component(parts, "sublocality") ||
          component(parts, "locality") ||
          null,
        city: component(parts, "locality") || null,
        region: component(parts, "administrative_area_level_1") || null,
        postcode: component(parts, "postal_code") || null,
        lat: data.location?.latitude ?? null,
        lng: data.location?.longitude ?? null,
      },
    };
  },
  { method: "GET", name: "places/details", rateLimit: RATE_LIMIT.places }
);
