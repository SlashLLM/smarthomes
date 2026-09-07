/* Lead capture.
 *
 * Order matters: persist to Supabase FIRST, then email. A Resend outage or a spam
 * filter must not silently lose a lead. The insert is required; the email is
 * best-effort and only stamps emailed_at when it actually succeeds.
 */

import { Resend } from "resend";
import { createHandler, ApiError } from "./_lib/handler.js";
import { getSupabase } from "./_lib/supabase.js";
import { RATE_LIMIT } from "./_lib/config.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const money = (n) =>
  typeof n === "number" && Number.isFinite(n)
    ? "$" + Math.round(n).toLocaleString("en-NZ")
    : "—";

function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function validate(body) {
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const phone = String(body.phone || "").trim();

  if (name.length < 2) throw new ApiError(400, "bad_request", "Please enter your name.");
  if (!EMAIL_RE.test(email)) {
    throw new ApiError(400, "bad_request", "Please enter a valid email address.");
  }
  if (phone && phone.replace(/\D/g, "").length < 7) {
    throw new ApiError(400, "bad_request", "Please enter a valid phone number.");
  }

  return { name: name.slice(0, 120), email: email.slice(0, 200), phone: phone.slice(0, 40) };
}

/* Which form the lead came from. The assessment CTA carries no calculator
 * numbers, so the email is shaped differently for it. */
function readSource(body) {
  return body.source === "assessment" ? "assessment" : "calculator";
}

function buildEmail(lead, body, source) {
  const e = body.estimate || {};
  const p = body.projection || {};
  const hasEstimate = Boolean(body.estimate);
  const row = (label, value) =>
    `<tr><td style="padding:6px 16px 6px 0;color:#6b6b63;">${escapeHtml(label)}</td>` +
    `<td style="padding:6px 0;font-weight:600;">${escapeHtml(value)}</td></tr>`;
  const table = (rows) =>
    `<table style="border-collapse:collapse;font-size:14px;margin-bottom:20px;">${rows.join("")}</table>`;

  const heading =
    source === "assessment" ? "New assessment booking" : "New calculator lead";

  const contact = [
    row("Name", lead.name),
    row("Email", lead.email),
    row("Mobile", lead.phone || "—"),
  ];
  // Not a leads column — it rides along in the notification only.
  if (body.preferredTime) {
    contact.push(row("Preferred time", String(body.preferredTime).slice(0, 60)));
  }

  // The assessment form only collects a typed address, so the property table
  // would otherwise be four dashes. Skip it entirely there.
  const property = hasEstimate
    ? [
        row("Address", body.formattedAddress || "—"),
        row("Bedrooms", body.bedrooms ?? "—"),
        row("Type", body.dwellingType || "—"),
        row("Scenario", body.scenario === "new" ? "New / not rented" : "Currently rented"),
        row("Current rent", body.currentWeeklyRent ? money(body.currentWeeklyRent) + "/wk" : "—"),
      ]
    : [];

  const estimate = hasEstimate
    ? [
        row("Market rent", e.weeklyMarketRent ? money(e.weeklyMarketRent) + "/wk" : "—"),
        row("Nightly rate", e.nightlyRate ? money(e.nightlyRate) : "—"),
        row("Occupancy", typeof e.occupancy === "number" ? Math.round(e.occupancy * 100) + "%" : "—"),
        row("STR income / yr", money(p.strAnnual)),
        row("Long-term / yr", money(p.ltrAnnual)),
        row("5yr STR", money(p.fiveYearStr)),
        row("5yr long-term", money(p.fiveYearLtr)),
        row("5yr difference", money(p.fiveYearDiff)),
        row("Confidence", e.confidence != null ? e.confidence + "%" : "—"),
        row("Comparables", e.comparablesFound ?? "—"),
        row(
          "Data source",
          e.source === "cache"
            ? "Cached analysis"
            : e.source === "locality"
              ? "Suburb-level fallback"
              : "Live analysis"
        ),
      ]
    : [];

  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px;color:#1c1c19;">
  <h2 style="margin:0 0 4px;">${heading}</h2>
  <p style="margin:0 0 20px;color:#6b6b63;">${escapeHtml(body.formattedAddress || "Address not recorded")}</p>

  <h3 style="margin:0 0 8px;font-size:15px;">Contact</h3>
  ${table(contact)}

  ${property.length ? `<h3 style="margin:0 0 8px;font-size:15px;">Property</h3>${table(property)}` : ""}
  ${estimate.length ? `<h3 style="margin:0 0 8px;font-size:15px;">Estimate</h3>${table(estimate)}` : ""}

  ${e.rationale ? `<p style="font-size:14px;color:#3a3a35;"><strong>Model rationale:</strong> ${escapeHtml(e.rationale)}</p>` : ""}
  ${Array.isArray(e.sources) && e.sources.length ? `<p style="font-size:13px;color:#6b6b63;">Sources: ${escapeHtml(e.sources.join(", "))}</p>` : ""}
</div>`;
}

export default createHandler(
  async ({ body }) => {
    const lead = validate(body);
    const source = readSource(body);
    const db = getSupabase();

    if (!db) {
      throw new ApiError(503, "not_configured", "Lead capture is not configured yet.");
    }

    // insert_lead is a security definer RPC: the anon key has no grant on the
    // leads table itself, so this is the only way a lead can be written — and
    // there is no matching read RPC, so it can never be read back out.
    const { data: leadId, error } = await db.rpc("insert_lead", {
      p_name: lead.name,
      p_email: lead.email,
      p_phone: lead.phone || null,
      p_place_id: body.placeId || null,
      p_formatted_address: body.formattedAddress || null,
      p_bedrooms: Number.isFinite(Number(body.bedrooms)) ? Number(body.bedrooms) : null,
      p_dwelling_type: body.dwellingType || null,
      p_scenario: body.scenario || null,
      p_current_weekly_rent: Number(body.currentWeeklyRent) || null,
      p_estimate: body.estimate || null,
      p_projection: body.projection || null,
    });

    if (error) {
      console.error("[lead] insert failed:", error.message);
      throw new ApiError(502, "lead_failed", "We couldn't save your details. Please try again.");
    }

    // From here on the lead is safe. Email failures are logged, not surfaced —
    // the user has done their part and the record exists.
    const { RESEND_API_KEY, LEAD_TO_EMAIL, LEAD_FROM_EMAIL } = process.env;
    if (RESEND_API_KEY && LEAD_TO_EMAIL && LEAD_FROM_EMAIL) {
      try {
        const resend = new Resend(RESEND_API_KEY);
        const { error: sendError } = await resend.emails.send({
          from: LEAD_FROM_EMAIL,
          to: LEAD_TO_EMAIL,
          replyTo: lead.email,
          subject:
            (source === "assessment" ? "New assessment booking" : "New calculator lead") +
            ` — ${body.formattedAddress || lead.name}`,
          html: buildEmail(lead, body, source),
        });
        if (sendError) throw new Error(sendError.message);

        await db.rpc("mark_lead_emailed", { p_id: leadId });
      } catch (err) {
        console.error("[lead] email failed (lead was still saved):", err?.message);
      }
    } else {
      console.warn("[lead] Resend not configured; lead saved without notification.");
    }

    return { ok: true, id: leadId };
  },
  { method: "POST", name: "lead", rateLimit: RATE_LIMIT.lead }
);
