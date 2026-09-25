/* Admin leads dashboard (/admin). Talks only to api/admin/*; the session is an
 * HttpOnly cookie, so this file never sees a credential after the login POST. */

import { computeAppraisal } from "../shared/appraisal.js";
import { cleanRationale } from "../shared/rationale.js";

/* Same values as CALC in api/_lib/config.js (which reads process.env, so it
   can't be bundled here). Used only for the live preview; the PDF itself is
   computed server-side from the saved settings. */
const CALC = { STR_NET_FACTOR: 0.82, MAX_OCCUPANCY: 0.92, STR_GROWTH: 1.06, LTR_GROWTH: 1.025 };

const STATUSES = [
  ["new", "New"],
  ["contacted", "Contacted"],
  ["report_sent", "Report sent"],
  ["won", "Won"],
  ["lost", "Lost"],
];
const STATUS_LABEL = Object.fromEntries(STATUSES);
const STATUS_STYLE = {
  new: "bg-brand-peach text-brand-accentDark",
  contacted: "bg-sky-100 text-sky-800",
  report_sent: "bg-violet-100 text-violet-800",
  won: "bg-green-100 text-green-800",
  lost: "bg-stone-200 text-stone-700",
};

const $ = (id) => document.getElementById(id);

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

const money = (n) =>
  typeof n === "number" && Number.isFinite(n) ? "$" + Math.round(n).toLocaleString("en-NZ") : "—";

const pct = (n) => (typeof n === "number" ? Math.round(n * 100) + "%" : "—");

const dateTime = (iso) =>
  new Date(iso).toLocaleString("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/admin/login") {
    showLogin();
    throw new Error("Session expired. Please sign in again.");
  }
  if (!res.ok) throw new Error(data.message || "Request failed.");
  return data;
}

/* ---------------- auth ---------------- */

function showLogin() {
  $("app").hidden = true;
  $("login").hidden = false;
  $("password").focus();
}

function showApp() {
  $("login").hidden = true;
  $("app").hidden = false;
  load();
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter || $("loginForm").querySelector("button");
  $("loginError").hidden = true;
  btn.disabled = true;
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: $("password").value }),
    });
    $("password").value = "";
    showApp();
  } catch (err) {
    $("loginError").textContent = err.message;
    $("loginError").hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" }).catch(() => {});
  showLogin();
});

/* ---------------- list ---------------- */

const state = { status: "", page: 0, leads: [], total: 0, pageSize: 50, counts: {} };

/** Local-midnight ISO instants, so date filters follow the admin's own timezone. */
function dayStart(value, addDays = 0) {
  if (!value) return "";
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d + addDays).toISOString();
}

function filterParams() {
  const p = new URLSearchParams();
  if (state.status) p.set("status", state.status);
  if ($("fSource").value) p.set("source", $("fSource").value);
  if ($("fSearch").value.trim()) p.set("search", $("fSearch").value.trim());
  if ($("fFrom").value) p.set("from", dayStart($("fFrom").value));
  if ($("fTo").value) p.set("to", dayStart($("fTo").value, 1)); // inclusive
  return p;
}

let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  const params = filterParams();
  $("exportBtn").href = "/api/admin/export?" + params;
  params.set("page", state.page);
  $("listError").hidden = true;
  try {
    const data = await api("/api/admin/leads?" + params);
    if (seq !== loadSeq) return; // a newer filter change won
    Object.assign(state, data);
    render();
  } catch (err) {
    if (seq !== loadSeq) return;
    $("listError").textContent = err.message;
    $("listError").hidden = false;
  }
}

function renderTabs() {
  const all = Object.values(state.counts).reduce((a, b) => a + b, 0);
  const tabs = [["", "All", all], ...STATUSES.map(([k, l]) => [k, l, state.counts[k] ?? 0])];
  $("tabs").innerHTML = tabs
    .map(
      ([key, label, n]) => `
      <button type="button" data-status="${key}" aria-pressed="${state.status === key}"
        class="shrink-0 px-4 py-2 rounded-full text-sm font-bold border transition-colors ${
          state.status === key
            ? "bg-brand-ink text-brand-white border-brand-ink"
            : "bg-brand-white border-brand-apricot hover:bg-brand-papaya"
        }">${label} <span class="opacity-60 font-semibold">${n}</span></button>`
    )
    .join("");
}

function estimateSummary(l) {
  const e = l.estimate || {};
  const p = l.projection || {};
  if (!l.estimate) return `<span class="text-brand-inkSoft">—</span>`;
  return `<div class="font-semibold">${money(e.weeklyMarketRent)}/wk</div>
    <div class="text-xs text-brand-inkMuted">STR ${money(p.strAnnual)}/yr</div>`;
}

const pill = (status) =>
  `<span class="inline-block px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${
    STATUS_STYLE[status] || ""
  }">${esc(STATUS_LABEL[status] || status)}</span>`;

function render() {
  renderTabs();

  $("rows").innerHTML = state.leads
    .map(
      (l, i) => `
      <tr data-i="${i}" tabindex="0" class="cursor-pointer hover:bg-brand-cream focus:bg-brand-cream focus:outline-none">
        <td class="px-4 py-3 whitespace-nowrap text-brand-inkMuted">${esc(dateTime(l.created_at))}</td>
        <td class="px-4 py-3">
          <div class="font-bold">${esc(l.name)}</div>
          <div class="text-xs text-brand-inkMuted">${esc(l.email)}${l.phone ? " · " + esc(l.phone) : ""}</div>
        </td>
        <td class="px-4 py-3 max-w-xs truncate" title="${esc(l.formatted_address)}">${esc(l.formatted_address || "—")}</td>
        <td class="px-4 py-3 capitalize">${esc(l.source)}</td>
        <td class="px-4 py-3 whitespace-nowrap">${estimateSummary(l)}</td>
        <td class="px-4 py-3">${pill(l.status)}</td>
      </tr>`
    )
    .join("");

  $("empty").hidden = state.leads.length > 0;

  const first = state.total ? state.page * state.pageSize + 1 : 0;
  const last = Math.min(state.total, (state.page + 1) * state.pageSize);
  $("summary").textContent = `${state.total} lead${state.total === 1 ? "" : "s"}`;
  $("pageInfo").textContent = state.total ? `${first}–${last} of ${state.total}` : "";
  $("prevPage").disabled = state.page === 0;
  $("nextPage").disabled = last >= state.total;
}

$("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-status]");
  if (!btn) return;
  state.status = btn.dataset.status;
  state.page = 0;
  load();
});

let searchTimer;
$("filters").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(
    () => {
      state.page = 0;
      load();
    },
    e.target.id === "fSearch" ? 300 : 0
  );
});
$("filters").addEventListener("submit", (e) => e.preventDefault());

$("clearFilters").addEventListener("click", () => {
  $("filters").reset();
  state.status = "";
  state.page = 0;
  load();
});

$("prevPage").addEventListener("click", () => {
  state.page = Math.max(0, state.page - 1);
  load();
});
$("nextPage").addEventListener("click", () => {
  state.page += 1;
  load();
});

$("rows").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-i]");
  if (tr) openDrawer(state.leads[Number(tr.dataset.i)]);
});
$("rows").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const tr = e.target.closest("tr[data-i]");
  if (!tr) return;
  e.preventDefault();
  openDrawer(state.leads[Number(tr.dataset.i)]);
});

/* ---------------- detail drawer ---------------- */

let current = null;
let returnFocus = null;

const section = (title, rows) => {
  const body = rows
    .filter(([, v]) => v != null && v !== "" && v !== "—")
    .map(
      ([k, v]) => `<div class="flex justify-between gap-4 py-1.5">
        <dt class="text-brand-inkMuted">${esc(k)}</dt><dd class="font-semibold text-right">${v}</dd></div>`
    )
    .join("");
  return body
    ? `<section><h3 class="field-label">${esc(title)}</h3>
        <dl class="bg-brand-white border border-brand-borderTone rounded-2xl px-4 py-2 text-sm divide-y divide-brand-apricot/50">${body}</dl></section>`
    : "";
};

function renderDetail(l) {
  const e = l.estimate || {};
  const p = l.projection || {};
  const dataSource =
    e.source === "cache" ? "Cached analysis" : e.source === "locality" ? "Suburb-level fallback" : e.source ? "Live analysis" : null;

  $("dName").textContent = l.name;
  $("dMeta").textContent = `${dateTime(l.created_at)} · ${l.source}`;

  $("dBody").innerHTML = [
    section("Contact", [
      ["Email", `<a class="text-brand-accentDark hover:underline" href="mailto:${esc(l.email)}">${esc(l.email)}</a>`],
      ["Phone", l.phone ? `<a class="text-brand-accentDark hover:underline" href="tel:${esc(l.phone.replace(/[^\d+]/g, ""))}">${esc(l.phone)}</a>` : null],
      ["Preferred time", l.preferred_time ? esc(l.preferred_time) : null],
    ]),
    section("Property", [
      ["Address", l.formatted_address ? esc(l.formatted_address) : null],
      ["Bedrooms", l.bedrooms != null ? esc(l.bedrooms) : null],
      ["Type", l.dwelling_type ? esc(l.dwelling_type) : null],
      ["Scenario", l.scenario ? (l.scenario === "new" ? "New / not rented" : "Currently rented") : null],
      ["Current rent", l.current_weekly_rent ? money(Number(l.current_weekly_rent)) + "/wk" : null],
    ]),
    section("Estimate", [
      ["Market rent", e.weeklyMarketRent ? money(e.weeklyMarketRent) + "/wk" : null],
      ["Nightly rate", e.nightlyRate ? money(e.nightlyRate) : null],
      ["Occupancy", typeof e.occupancy === "number" ? pct(e.occupancy) : null],
      ["Confidence", e.confidence != null ? esc(e.confidence) + "%" : null],
      ["Comparables", e.comparablesFound != null ? esc(e.comparablesFound) : null],
      ["Data source", dataSource],
    ]),
    section("Projection", [
      ["STR income / yr", l.projection ? money(p.strAnnual) : null],
      ["Long-term / yr", l.projection ? money(p.ltrAnnual) : null],
      ["5yr STR", l.projection ? money(p.fiveYearStr) : null],
      ["5yr long-term", l.projection ? money(p.fiveYearLtr) : null],
      ["5yr difference", l.projection ? money(p.fiveYearDiff) : null],
    ]),
    e.rationale
      ? `<section><h3 class="field-label">Model rationale</h3><p class="text-sm leading-relaxed">${esc(cleanRationale(e.rationale))}</p></section>`
      : "",
    Array.isArray(e.sources) && e.sources.length
      ? `<section><h3 class="field-label">Sources</h3><ul class="text-sm list-disc pl-5 space-y-1 break-all">${e.sources
          .map((s) => `<li>${esc(s)}</li>`)
          .join("")}</ul></section>`
      : "",
    l.estimate || l.projection
      ? `<details class="text-sm"><summary class="cursor-pointer font-bold text-brand-inkMuted">Raw data</summary>
          <pre class="mt-2 p-3 bg-brand-white border border-brand-borderTone rounded-xl overflow-x-auto text-xs">${esc(
            JSON.stringify({ estimate: l.estimate, projection: l.projection }, null, 2)
          )}</pre></details>`
      : "",
  ].join("");

  $("dStatus").innerHTML = STATUSES.map(
    ([k, label]) => `<option value="${k}"${k === l.status ? " selected" : ""}>${label}</option>`
  ).join("");
  $("dNotes").value = l.notes || "";
  $("dError").hidden = true;
  $("dSaved").hidden = true;
  fillReport(l);
}

function openDrawer(lead) {
  current = lead;
  returnFocus = document.activeElement;
  renderDetail(lead);
  $("drawer").hidden = false;
  document.body.style.overflow = "hidden";
  $("drawerClose").focus();
}

function closeDrawer() {
  $("drawer").hidden = true;
  document.body.style.overflow = "";
  current = null;
  returnFocus?.focus?.();
}

$("drawerClose").addEventListener("click", closeDrawer);
$("drawerScrim").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("drawer").hidden) closeDrawer();
});

$("dForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!current) return;
  const btn = $("dSave");
  btn.disabled = true;
  $("dError").hidden = true;
  $("dSaved").hidden = true;
  try {
    const { lead } = await api("/api/admin/lead-update", {
      method: "POST",
      body: JSON.stringify({ id: current.id, status: $("dStatus").value, notes: $("dNotes").value }),
    });
    const statusChanged = lead.status !== current.status;
    Object.assign(current, lead);
    $("dSaved").hidden = false;
    // Refresh the list so tab counts (and the row, if it left this tab) are right.
    if (statusChanged) load();
    else render();
  } catch (err) {
    $("dError").textContent = err.message;
    $("dError").hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- boot ---------------- */

api("/api/admin/session")
  .then(({ authenticated }) => (authenticated ? showApp() : showLogin()))
  .catch(showLogin);

/* ---------------- appraisal report ---------------- */

const REPORT_INPUTS = [
  // [input id, lead column, stored value -> input value, input value -> stored value]
  ["rRent", "report_weekly_rent", (v) => v, (v) => v],
  ["rNightly", "report_nightly_rate", (v) => v, (v) => v],
  ["rOcc", "report_occupancy", (v) => +(v * 100).toFixed(1), (v) => +(v / 100).toFixed(3)],
  ["rCosts", "report_costs_pct", (v) => v, (v) => v],
];

/** The drawer's report settings as lead-update fields; blank clears an override. */
function readReport() {
  const out = {};
  for (const [id, key, , toStored] of REPORT_INPUTS) {
    const raw = $(id).value.trim();
    out[key] = raw === "" || !Number.isFinite(Number(raw)) ? null : toStored(Number(raw));
  }
  out.report_commentary = $("rCommentary").value;
  return out;
}

function fillReport(l) {
  const e = l.estimate || {};
  const fallback = {
    rRent: e.weeklyMarketRent ?? l.current_weekly_rent,
    rNightly: e.nightlyRate,
    rOcc: typeof e.occupancy === "number" ? Math.round(Math.min(CALC.MAX_OCCUPANCY, e.occupancy) * 100) : null,
    rCosts: Math.round((1 - CALC.STR_NET_FACTOR) * 100),
  };
  for (const [id, key, toInput] of REPORT_INPUTS) {
    $(id).value = l[key] != null ? toInput(Number(l[key])) : "";
    $(id).placeholder = fallback[id] != null ? String(Math.round(Number(fallback[id]))) : "Required";
  }
  $("rCommentary").value = l.report_commentary || "";
  $("rGenerated").textContent = l.report_generated_at ? "Last generated " + dateTime(l.report_generated_at) : "";
  $("rError").hidden = true;
  $("rSaved").hidden = true;
  renderReportPreview();
}

function renderReportPreview() {
  if (!current) return;
  const a = computeAppraisal({ ...current, ...readReport() }, CALC);
  const ready = Boolean(a);
  $("rView").disabled = $("rDownload").disabled = !ready;
  $("rPreview").innerHTML = ready
    ? `<div class="flex flex-wrap justify-between gap-x-6 gap-y-1">
        <span>Short-stay net <strong>${money(a.strNet)}</strong>/yr</span>
        <span>Long-term <strong>${money(a.ltrAnnual)}</strong>/yr</span>
        <span class="font-bold ${a.diff >= 0 ? "text-brand-accentDark" : ""}">${a.diff >= 0 ? "+" : "−"}${money(Math.abs(a.diff))} (${Math.round(a.upliftPct)}%)</span>
      </div>
      <div class="text-xs text-brand-inkMuted mt-1">${a.nightsBooked} nights × ${money(a.nightlyRate)}, less ${a.costsPct}% costs · 5-year difference ${money(a.fiveYearDiff)}</div>`
    : `<span class="text-brand-inkMuted">Add a market rent, nightly rate and occupancy to generate a report.</span>`;
}

$("rForm").addEventListener("input", () => {
  $("rSaved").hidden = true;
  renderReportPreview();
});

async function saveReport() {
  const { lead } = await api("/api/admin/lead-update", {
    method: "POST",
    body: JSON.stringify({ id: current.id, ...readReport() }),
  });
  Object.assign(current, lead);
}

/** Save the settings, then fetch the PDF the server renders from them. */
async function fetchReport(download) {
  await saveReport();
  const res = await fetch(
    `/api/admin/report?id=${encodeURIComponent(current.id)}${download ? "&download=1" : ""}`,
    { credentials: "same-origin" }
  );
  if (res.status === 401) {
    showLogin();
    throw new Error("Session expired. Please sign in again.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Couldn't generate the report.");
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1];
  current.report_generated_at = new Date().toISOString();
  return { blob: await res.blob(), name: name || "smarthomes-appraisal.pdf" };
}

async function reportAction(btn, fn) {
  if (!current) return;
  const buttons = [$("rSave"), $("rView"), $("rDownload")];
  buttons.forEach((b) => (b.disabled = true));
  $("rError").hidden = true;
  $("rSaved").hidden = true;
  const label = btn.textContent;
  btn.textContent = btn === $("rSave") ? "Saving…" : "Generating…";
  try {
    await fn();
    fillReport(current);
    $("rSaved").hidden = btn !== $("rSave");
    render();
  } catch (err) {
    $("rError").textContent = err.message;
    $("rError").hidden = false;
  } finally {
    btn.textContent = label;
    $("rSave").disabled = false;
    renderReportPreview(); // re-enables the PDF buttons only if the numbers are complete
  }
}

$("rForm").addEventListener("submit", (e) => {
  e.preventDefault();
  reportAction($("rSave"), saveReport);
});

$("rView").addEventListener("click", () => {
  // Open the tab inside the click so popup blockers allow it, then fill it.
  const tab = window.open("", "_blank");
  reportAction($("rView"), async () => {
    try {
      const { blob } = await fetchReport(false);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      throw err;
    }
  });
});

$("rDownload").addEventListener("click", () =>
  reportAction($("rDownload"), async () => {
    const { blob, name } = await fetchReport(true);
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  })
);
