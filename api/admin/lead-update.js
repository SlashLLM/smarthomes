/* Change a lead's pipeline status, notes and/or appraisal report settings. */

import { createHandler, ApiError } from "../_lib/handler.js";
import { RATE_LIMIT } from "../_lib/config.js";
import { requireAdmin, getAdminSupabase, LEAD_STATUSES } from "../_lib/admin.js";
import { REPORT_FIELDS, COMMENTARY_MAX } from "../../shared/appraisal.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default createHandler(
  async ({ req, body }) => {
    requireAdmin(req);

    if (!UUID_RE.test(String(body.id || ""))) {
      throw new ApiError(400, "bad_request", "Missing lead id.");
    }

    const patch = {};
    if (body.status !== undefined) {
      if (!LEAD_STATUSES.includes(body.status)) {
        throw new ApiError(400, "bad_request", "Unknown status.");
      }
      patch.status = body.status;
    }
    if (body.notes !== undefined) {
      const notes = String(body.notes ?? "").slice(0, 5000);
      patch.notes = notes.trim() ? notes : null;
    }
    // Report overrides: "" or null clears one back to the calculator's figure.
    for (const [key, { min, max }] of Object.entries(REPORT_FIELDS)) {
      if (body[key] === undefined) continue;
      if (body[key] === null || body[key] === "") {
        patch[key] = null;
        continue;
      }
      const n = Number(body[key]);
      if (!Number.isFinite(n) || n < min || n > max) {
        throw new ApiError(400, "bad_request", `${key.replace("report_", "").replace(/_/g, " ")} must be between ${min} and ${max}.`);
      }
      patch[key] = n;
    }
    if (body.report_commentary !== undefined) {
      const text = String(body.report_commentary ?? "").slice(0, COMMENTARY_MAX);
      patch.report_commentary = text.trim() ? text : null;
    }

    if (!Object.keys(patch).length) {
      throw new ApiError(400, "bad_request", "Nothing to update.");
    }
    patch.updated_at = new Date().toISOString();

    const { data, error } = await getAdminSupabase()
      .from("leads")
      .update(patch)
      .eq("id", body.id)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("[admin-lead-update]", error.message);
      throw new ApiError(502, "db_error", "Couldn't save the lead.");
    }
    if (!data) throw new ApiError(404, "not_found", "Lead not found.");
    return { lead: data };
  },
  { method: "POST", name: "admin-lead-update", rateLimit: RATE_LIMIT.admin }
);
