/* Admin portal: password login, session cookie, and the service-role client.
 *
 * Auth is a single shared password from ADMIN_PASSWORD. A successful login sets
 * an HttpOnly, SameSite=Strict cookie holding `<expiry>.<hmac>`; there is no
 * session table. The HMAC key is derived from the password itself, so changing
 * ADMIN_PASSWORD logs every existing session out.
 *
 * Unlike the public endpoints, api/admin/* reads and writes `leads` with the
 * SERVICE ROLE key, which bypasses RLS. That key must never be used outside
 * this module, and every admin endpoint must call requireAdmin() first.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ApiError, requireEnv } from "./handler.js";

const COOKIE = "sh_admin";
const SESSION_SECONDS = 12 * 60 * 60;
const MIN_PASSWORD_LENGTH = 12;

export const LEAD_STATUSES = ["new", "contacted", "report_sent", "won", "lost"];
export const LEAD_SOURCES = ["calculator", "assessment"];

function password() {
  const { ADMIN_PASSWORD } = requireEnv("ADMIN_PASSWORD");
  if (ADMIN_PASSWORD.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(
      503,
      "not_configured",
      `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }
  return ADMIN_PASSWORD;
}

const signingKey = () =>
  createHmac("sha256", password()).update("smarthomes-admin-session-v1").digest();

const sign = (payload) =>
  createHmac("sha256", signingKey()).update(payload).digest("base64url");

/** Constant-time string compare. Hashing first equalises the lengths. */
function safeEqual(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function checkPassword(candidate) {
  return typeof candidate === "string" && safeEqual(candidate, password());
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function cookieAttrs(maxAge) {
  // Secure is skipped only in local dev so the cookie still works over plain
  // http on a LAN address; Vercel always serves https.
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function setSessionCookie(res) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const token = `${exp}.${sign(`admin:${exp}`)}`;
  res.setHeader("Set-Cookie", `${COOKIE}=${token}${cookieAttrs(SESSION_SECONDS)}`);
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=${cookieAttrs(0)}`);
}

export function isAdmin(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return false;
  const [exp, mac] = token.split(".");
  if (!/^\d+$/.test(exp || "") || !mac) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return safeEqual(mac, sign(`admin:${exp}`));
}

/** Call first in every admin endpoint. */
export function requireAdmin(req) {
  if (!isAdmin(req)) throw new ApiError(401, "unauthorized", "Please sign in.");
}

let adminClient;

/** Service-role client. Bypasses RLS — admin endpoints only, after requireAdmin(). */
export function getAdminSupabase() {
  if (adminClient) return adminClient;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = requireEnv(
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY"
  );
  adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "smarthomes-admin" } },
  });
  return adminClient;
}

/**
 * Apply the dashboard's filters to a `leads` query. Shared by the list and the
 * CSV export so both always agree on what "the current view" is.
 */
export function applyLeadFilters(q, { status, source, from, to, search } = {}) {
  if (status && LEAD_STATUSES.includes(status)) q = q.eq("status", status);
  if (source && LEAD_SOURCES.includes(source)) q = q.eq("source", source);
  // from/to are ISO instants. The browser turns its date pickers into local
  // midnights, so NZ daylight saving is handled there rather than guessed here.
  const instant = (v) => {
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
  };
  if (instant(from)) q = q.gte("created_at", instant(from));
  if (instant(to)) q = q.lt("created_at", instant(to));
  // PostgREST's or() filter has its own syntax, so strip anything that could
  // break out of the ilike pattern rather than trying to escape it.
  const term = String(search || "").replace(/[,()*%\\"':]/g, " ").trim().slice(0, 100);
  if (term) {
    const like = `%${term}%`;
    q = q.or(
      ["name", "email", "phone", "formatted_address"].map((c) => `${c}.ilike.${like}`).join(",")
    );
  }
  return q;
}
