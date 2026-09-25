/* Appraisal report PDF for one lead.
 *
 * GET /api/admin/report?id=<uuid>             -> inline, for the preview tab
 * GET /api/admin/report?id=<uuid>&download=1  -> attachment
 *
 * Uses the lead's saved report_* overrides (migration 0004) on top of its stored
 * estimate, so the admin saves the drawer's report settings before generating.
 */

import { createHandler, ApiError } from "../_lib/handler.js";
import { RATE_LIMIT } from "../_lib/config.js";
import { requireAdmin, getAdminSupabase } from "../_lib/admin.js";
import { generateAppraisalPdf } from "../_lib/pdf-report.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function filename(lead) {
  const slug = String(lead.formatted_address || lead.name || "lead")
    .split(",")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `smarthomes-appraisal-${slug || "lead"}.pdf`;
}

export default createHandler(
  async ({ req, res, query }) => {
    requireAdmin(req);
    if (!UUID_RE.test(String(query.id || ""))) {
      throw new ApiError(400, "bad_request", "Missing lead id.");
    }

    const db = getAdminSupabase();
    const { data: lead, error } = await db.from("leads").select("*").eq("id", query.id).maybeSingle();
    if (error) {
      console.error("[admin-report]", error.message);
      throw new ApiError(502, "db_error", "Couldn't load the lead.");
    }
    if (!lead) throw new ApiError(404, "not_found", "Lead not found.");

    const pdf = await generateAppraisalPdf(lead);
    if (!pdf) {
      throw new ApiError(
        422,
        "incomplete",
        "Add a market rent, nightly rate and occupancy in the report settings first."
      );
    }

    // Best-effort audit stamp; a failure here must not block the download.
    const { error: stampError } = await db
      .from("leads")
      .update({ report_generated_at: new Date().toISOString() })
      .eq("id", lead.id);
    if (stampError) console.warn("[admin-report] stamp failed:", stampError.message);

    const disposition = query.download ? "attachment" : "inline";
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${disposition}; filename="${filename(lead)}"`);
    res.setHeader("Content-Length", pdf.length);
    res.setHeader("Cache-Control", "no-store");
    res.end(pdf);
  },
  { name: "admin-report", rateLimit: RATE_LIMIT.admin }
);
