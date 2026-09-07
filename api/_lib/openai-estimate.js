/* Web-search-grounded rent + short-stay estimate.
 *
 * Strategy A is one call combining the `web_search` tool with a strict json_schema
 * response format. OpenAI documents both features but does not document them being
 * used together, so Strategy B splits them: research with web_search producing free
 * text, then a cheap tool-less extraction call that converts that text to strict
 * JSON. A is tried first because it is one round trip; B is the guaranteed path.
 */

import OpenAI from "openai";
import { DEFAULT_OPENAI_MODEL, BOUNDS } from "./config.js";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "weeklyMarketRent",
    "nightlyRate",
    "occupancy",
    "confidence",
    "comparablesFound",
    "sources",
    "rationale",
  ],
  properties: {
    weeklyMarketRent: {
      type: "number",
      description: "Current long-term market rent in NZD per week for this property.",
    },
    nightlyRate: {
      type: "number",
      description:
        "Average achievable short-stay nightly rate in NZD, annualised across seasons.",
    },
    occupancy: {
      type: "number",
      description: "Realistic annual average short-stay occupancy, 0 to 1.",
    },
    confidence: {
      type: "integer",
      description: "0-100. How well the comparables actually support these figures.",
    },
    comparablesFound: {
      type: "integer",
      description: "Number of genuinely comparable listings found during the search.",
    },
    sources: {
      type: "array",
      items: { type: "string" },
      description: "Hostnames actually consulted, e.g. trademe.co.nz.",
    },
    rationale: {
      type: "string",
      description: "One or two plain sentences explaining the estimate.",
    },
  },
};

const SYSTEM = `You are a New Zealand residential property analyst producing income estimates for a property management company's public calculator.

Search current New Zealand listings before answering:
- Long-term market rent: trademe.co.nz/property, realestate.co.nz, oneroof.co.nz
- Short-stay rates and occupancy: airbnb.co.nz, bookabach.co.nz, booking.com

Rules:
- Base every figure on comparables near the given address matching the bedroom count and dwelling type. Prefer the same suburb.
- nightlyRate must be an annualised average across peak and off-peak, not a peak-season headline rate.
- occupancy must be realistic for the location's seasonality. NZ coastal and alpine holiday markets are strongly seasonal; year-round urban markets are steadier.
- All money is NZD. weeklyMarketRent is per week; nightlyRate is per night. Do not confuse the two.
- Set confidence honestly. If you found few or weak comparables, say so with a low number rather than inflating it.
- comparablesFound must be the real count you actually used.
- Report only hostnames you genuinely consulted in sources.
- Return numbers only, no currency symbols or ranges.`;

function buildPrompt({ place, bedrooms, dwellingType, grounding }) {
  const lines = [
    `Property: ${place.formattedAddress}`,
    `Suburb: ${place.locality || "unknown"}`,
    `City: ${place.city || "unknown"}`,
    `Region: ${place.region || "unknown"}`,
    `Bedrooms: ${bedrooms}`,
    `Dwelling type: ${dwellingType}`,
  ];

  // Anchor to what we already know about this suburb so neighbouring properties
  // don't drift apart between calls.
  if (grounding) {
    lines.push(
      "",
      `Previous analyses of ${bedrooms}-bedroom ${dwellingType}s in this suburb ` +
        `(median of ${grounding.sampleSize}): ` +
        `weekly rent NZ$${Math.round(grounding.weeklyMarketRent)}, ` +
        `nightly rate NZ$${Math.round(grounding.nightlyRate)}, ` +
        `occupancy ${Math.round(grounding.occupancy * 100)}%.`,
      "Treat these as a sanity check. Deviate where this specific address genuinely warrants it, but explain why in the rationale."
    );
  }

  lines.push(
    "",
    "Estimate the long-term market rent and the short-stay performance for this property."
  );
  return lines.join("\n");
}

/** Walk the Responses output for web_search sources and citation annotations. */
function extractSources(response) {
  const hosts = new Set();
  const push = (url) => {
    if (!url) return;
    try {
      hosts.add(new URL(url).hostname.replace(/^www\./, ""));
    } catch {
      /* not a URL, ignore */
    }
  };

  for (const item of response?.output || []) {
    for (const source of item?.action?.sources || []) {
      push(typeof source === "string" ? source : source?.url);
    }
    for (const chunk of item?.content || []) {
      for (const annotation of chunk?.annotations || []) {
        if (annotation?.type === "url_citation") push(annotation.url);
      }
    }
  }
  return [...hosts];
}

/** Pull a JSON object out of a text response, tolerating code fences and prose. */
function parseJsonLoose(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    /* fall through to brace scan */
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/* Reject implausible output rather than rendering it. A web-grounded model can
 * still return a bad number, and every figure on this card reads as a promise. */
function validate(raw) {
  if (!raw || typeof raw !== "object") return null;

  const num = (v) => {
    const n = typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const weeklyMarketRent = num(raw.weeklyMarketRent);
  const nightlyRate = num(raw.nightlyRate);
  let occupancy = num(raw.occupancy);

  if (weeklyMarketRent === null || nightlyRate === null || occupancy === null) {
    return null;
  }
  // Models sometimes return occupancy as a percentage despite the instruction.
  if (occupancy > 1) occupancy /= 100;

  const inRange = (v, b) => v >= b.min && v <= b.max;
  if (!inRange(weeklyMarketRent, BOUNDS.weeklyMarketRent)) return null;
  if (!inRange(nightlyRate, BOUNDS.nightlyRate)) return null;
  if (!inRange(occupancy, BOUNDS.occupancy)) return null;

  // Catches a weekly figure returned in the nightly field, and vice versa.
  const ratio = nightlyRate / weeklyMarketRent;
  if (!inRange(ratio, BOUNDS.nightlyToWeeklyRatio)) return null;

  const confidence = Math.max(0, Math.min(100, Math.round(num(raw.confidence) ?? 0)));
  const comparablesFound = Math.max(0, Math.round(num(raw.comparablesFound) ?? 0));

  return {
    weeklyMarketRent: Math.round(weeklyMarketRent),
    nightlyRate: Math.round(nightlyRate),
    occupancy: Number(occupancy.toFixed(3)),
    confidence,
    comparablesFound,
    sources: Array.isArray(raw.sources)
      ? raw.sources.filter((s) => typeof s === "string" && s).slice(0, 8)
      : [],
    rationale: typeof raw.rationale === "string" ? raw.rationale.slice(0, 600) : "",
  };
}

export async function requestEstimate({ place, bedrooms, dwellingType, grounding, signal }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const prompt = buildPrompt({ place, bedrooms, dwellingType, grounding });

  const format = {
    type: "json_schema",
    name: "property_income_estimate",
    schema: SCHEMA,
    strict: true,
  };

  // --- Strategy A: search and structure in one call ---
  try {
    const response = await client.responses.create(
      {
        model,
        tools: [{ type: "web_search" }],
        text: { format },
        input: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
      },
      { signal }
    );

    const parsed = validate(parseJsonLoose(response.output_text));
    if (parsed) {
      const searched = extractSources(response);
      if (searched.length) parsed.sources = searched.slice(0, 8);
      return { estimate: parsed, model, strategy: "single" };
    }
    console.warn("[estimate] single-call output failed validation; falling back");
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    console.warn("[estimate] single-call strategy failed:", err?.message);
  }

  // --- Strategy B: research, then extract ---
  const research = await client.responses.create(
    {
      model,
      tools: [{ type: "web_search" }],
      input: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content:
            prompt +
            "\n\nList the specific comparable listings you found with their prices, then state your estimated weekly market rent, average nightly rate, and annual occupancy.",
        },
      ],
    },
    { signal }
  );

  const searched = extractSources(research);

  const extraction = await client.responses.create(
    {
      model,
      text: { format },
      input: [
        {
          role: "system",
          content:
            "Convert the analyst's findings into the required JSON. Use only figures present in the findings. Do not invent numbers.",
        },
        { role: "user", content: research.output_text || "" },
      ],
    },
    { signal }
  );

  const parsed = validate(parseJsonLoose(extraction.output_text));
  if (!parsed) return null;
  if (searched.length) parsed.sources = searched.slice(0, 8);
  return { estimate: parsed, model, strategy: "two-step" };
}
