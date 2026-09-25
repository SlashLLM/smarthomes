/* Paged, filtered lead list for the dashboard, plus per-status counts for the tabs. */

import { createHandler, ApiError } from "../_lib/handler.js";
import { RATE_LIMIT } from "../_lib/config.js";
import {
  requireAdmin,
  getAdminSupabase,
  applyLeadFilters,
  LEAD_STATUSES,
} from "../_lib/admin.js";

const PAGE_SIZE = 50;

export default createHandler(
  async ({ req, query }) => {
    requireAdmin(req);
    const db = getAdminSupabase();

    const page = Math.max(0, Math.min(10_000, Number.parseInt(query.page, 10) || 0));
    const start = page * PAGE_SIZE;

    const list = applyLeadFilters(
      db.from("leads").select("*", { count: "exact" }),
      query
    )
      .order("created_at", { ascending: false })
      .range(start, start + PAGE_SIZE - 1);

    // Tab counts ignore the status filter itself but respect everything else,
    // so each tab shows what clicking it would return.
    const { status: _ignored, ...rest } = query;
    const counts = LEAD_STATUSES.map((s) =>
      applyLeadFilters(db.from("leads").select("id", { count: "exact", head: true }), {
        ...rest,
        status: s,
      })
    );

    const [listRes, ...countRes] = await Promise.all([list, ...counts]);
    const failed = [listRes, ...countRes].find((r) => r.error);
    if (failed) {
      console.error("[admin-leads]", failed.error.message);
      throw new ApiError(502, "db_error", "Couldn't load leads.");
    }

    return {
      leads: listRes.data,
      total: listRes.count ?? 0,
      page,
      pageSize: PAGE_SIZE,
      counts: Object.fromEntries(LEAD_STATUSES.map((s, i) => [s, countRes[i].count ?? 0])),
    };
  },
  { name: "admin-leads", rateLimit: RATE_LIMIT.admin }
);
