/* CSV of every lead matching the dashboard's current filters. */

import { createHandler, ApiError } from "../_lib/handler.js";
import { RATE_LIMIT } from "../_lib/config.js";
import { requireAdmin, getAdminSupabase, applyLeadFilters } from "../_lib/admin.js";

const MAX_ROWS = 10_000;
const BATCH = 1000; // PostgREST's default max rows per request

const COLUMNS = [
  ["created_at", (l) => l.created_at],
  ["status", (l) => l.status],
  ["source", (l) => l.source],
  ["name", (l) => l.name],
  ["email", (l) => l.email],
  ["phone", (l) => l.phone],
  ["preferred_time", (l) => l.preferred_time],
  ["address", (l) => l.formatted_address],
  ["bedrooms", (l) => l.bedrooms],
  ["dwelling_type", (l) => l.dwelling_type],
  ["scenario", (l) => l.scenario],
  ["current_weekly_rent", (l) => l.current_weekly_rent],
  ["market_rent_weekly", (l) => l.estimate?.weeklyMarketRent],
  ["nightly_rate", (l) => l.estimate?.nightlyRate],
  ["occupancy", (l) => l.estimate?.occupancy],
  ["str_annual", (l) => l.projection?.strAnnual],
  ["ltr_annual", (l) => l.projection?.ltrAnnual],
  ["five_year_diff", (l) => l.projection?.fiveYearDiff],
  ["notes", (l) => l.notes],
  ["id", (l) => l.id],
];

function cell(v) {
  if (v == null) return "";
  let s = String(v);
  // Neutralise spreadsheet formula injection from user-typed fields.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default createHandler(
  async ({ req, res, query }) => {
    requireAdmin(req);
    const db = getAdminSupabase();

    const rows = [];
    for (let start = 0; start < MAX_ROWS; start += BATCH) {
      const { data, error } = await applyLeadFilters(db.from("leads").select("*"), query)
        .order("created_at", { ascending: false })
        .range(start, start + BATCH - 1);
      if (error) {
        console.error("[admin-export]", error.message);
        throw new ApiError(502, "db_error", "Couldn't export leads.");
      }
      rows.push(...data);
      if (data.length < BATCH) break;
    }

    const csv = [
      COLUMNS.map(([h]) => h).join(","),
      ...rows.map((l) => COLUMNS.map(([, get]) => cell(get(l))).join(",")),
    ].join("\r\n");

    const date = new Date().toISOString().slice(0, 10);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="smarthomes-leads-${date}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    res.end("﻿" + csv); // BOM so Excel reads UTF-8 names correctly
  },
  { name: "admin-export", rateLimit: RATE_LIMIT.admin }
);
