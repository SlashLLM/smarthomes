/* Minimal request-handling conventions shared by every function in api/.
 *
 * Works under both the Vercel Node runtime and the dev middleware in
 * vite-plugin-dev-api.js, which passes Node-shaped req/res objects.
 */

import { checkRateLimit } from "./cache.js";

const buckets = new Map();

/** Best-effort client IP. Vercel sets x-forwarded-for; dev falls back to the socket. */
function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

/* Fixed-window limiter held in module memory. Per-instance rather than global —
 * a serverless deployment may run several instances, so this throttles abuse and
 * runaway loops rather than enforcing an exact global quota.
 *
 * Kept as the cheap first line only. Anything that can spend money sets
 * `global: true` on its limit and is decided in Postgres by overLimit() below,
 * because "per instance" on Vercel means "per cold start" — an attacker gets a
 * fresh budget every time the platform scales out. */
function locallyRateLimited(req, name, limit) {
  if (!limit) return false;
  const key = `${name}:${clientIp(req)}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit.max;
}

/* The limit decision. Local Map first — it is free and rejects the obvious
 * cases without a round trip — then Postgres for the endpoints where the true
 * global count is what matters. checkRateLimit fails open, so a Supabase outage
 * degrades to the per-instance behaviour rather than locking everyone out. */
async function overLimit(req, name, limit) {
  if (!limit) return false;
  if (locallyRateLimited(req, name, limit)) return true;
  if (!limit.global) return false;
  return !(await checkRateLimit(`${name}:${clientIp(req)}`, limit.max, limit.windowMs));
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  // Vercel parses JSON bodies for us; the dev middleware does not.
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const err = new Error("Malformed JSON body");
    err.status = 400;
    err.code = "bad_request";
    throw err;
  }
}

/** Throw from a handler to return a specific status and error code to the client. */
export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Assert that every named env var is present, or fail with a clean 503. */
export function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    throw new ApiError(
      503,
      "not_configured",
      `Server is missing configuration: ${missing.join(", ")}`
    );
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n]]));
}

/**
 * Wrap a handler with method checking, body parsing, rate limiting and a
 * consistent error shape.
 *
 * @param {(ctx: {req, res, body, query, ip}) => Promise<any>} fn
 * @param {{ method?: string, rateLimit?: {max:number, windowMs:number}, name?: string }} opts
 */
export function createHandler(fn, opts = {}) {
  const { method = "GET", rateLimit, name = "api" } = opts;

  return async function handler(req, res) {
    try {
      if (req.method !== method) {
        res.setHeader("Allow", method);
        return send(res, 405, { error: "method_not_allowed" });
      }

      if (await overLimit(req, name, rateLimit)) {
        return send(res, 429, {
          error: "rate_limited",
          message: "Too many requests. Please try again shortly.",
        });
      }

      const url = new URL(req.url, "http://localhost");
      const body = method === "POST" ? await readJsonBody(req) : {};

      const result = await fn({
        req,
        res,
        body,
        query: Object.fromEntries(url.searchParams),
        ip: clientIp(req),
      });

      if (res.writableEnded) return undefined;
      return send(res, 200, result);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error(`[${name}]`, err);
      }
      // Messages from a deliberately thrown ApiError are written for the user and
      // are safe to return at any status — a 503 "not configured" is far more
      // useful than a generic 5xx. Unexpected throws stay opaque.
      const deliberate = err instanceof ApiError;
      return send(res, status, {
        error: err.code || "internal_error",
        message: deliberate
          ? err.message
          : status >= 500
            ? "Something went wrong on our end."
            : err.message || "Request failed.",
        ...(err.extra || {}),
      });
    }
  };
}
