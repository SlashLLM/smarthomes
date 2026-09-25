/* Owner-facing rental appraisal PDF.
 *
 * Drawn directly with pdfkit (no headless browser), so it renders inside a
 * normal Vercel function in well under a second. Colours are the "Warm
 * Architectural" tokens from tailwind.config.js and the type is the site's own
 * Plus Jakarta Sans, so the report reads as a first-party brand artefact.
 *
 * Four A4 pages: cover, appraisal at a glance, five-year outlook, next steps.
 */

import { readFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import { computeAppraisal } from "../../shared/appraisal.js";
import { CALC } from "./config.js";

const C = {
  white: "#FFFFFF",
  cream: "#FFF8E7",
  apricot: "#FFE4B5",
  peach: "#FFDAB9",
  papaya: "#FFEFD5",
  accent: "#C85A32",
  accentDark: "#A6431E",
  ink: "#2D241E",
  inkMuted: "#685950",
  inkSoft: "#766359",
  border: "#F3D5B5",
  hairline: "#F7E6D2",
  cardDark: "#2B221B",
  ltr: "#D9C2AA", // long-term rental series: a quiet sand next to the accent
  onDark: "#CDBBAE",
  onDarkMuted: "#9C8A7E",
};

// Resolved relative to this module, so Vercel's file tracer bundles them.
const FONT_FILES = {
  reg: new URL("./fonts/PlusJakartaSans-Regular.ttf", import.meta.url),
  med: new URL("./fonts/PlusJakartaSans-Medium.ttf", import.meta.url),
  semi: new URL("./fonts/PlusJakartaSans-SemiBold.ttf", import.meta.url),
  bold: new URL("./fonts/PlusJakartaSans-Bold.ttf", import.meta.url),
  black: new URL("./fonts/PlusJakartaSans-ExtraBold.ttf", import.meta.url),
};
const F = { reg: "PJS-Regular", med: "PJS-Medium", semi: "PJS-SemiBold", bold: "PJS-Bold", black: "PJS-ExtraBold" };
let fontCache;
const fonts = () =>
  (fontCache ??= Object.fromEntries(Object.entries(FONT_FILES).map(([k, url]) => [k, readFileSync(url)])));

const COMPANY = {
  name: "SmartHomes Property Management Ltd",
  phone: "0800 762 784",
  email: "kiaora@smarthomes.co.nz",
  web: "smarthomes.co.nz",
};

// A4 geometry, in points
const PW = 595.28;
const PH = 841.89;
const M = 48;
const CW = PW - M * 2;
const PAGES = 4;

// ── formatters ────────────────────────────────────────────────
const money = (n) => "$" + Math.round(Math.abs(Number(n) || 0)).toLocaleString("en-NZ");
const signedMoney = (n) => (Number(n) < 0 ? "-" : "+") + money(n);
const moneyK = (n) => {
  const v = Number(n) || 0;
  return Math.abs(v) >= 1000 ? "$" + Math.round(v / 1000) + "k" : money(v);
};
const pct0 = (n) => Math.round(Number(n) || 0) + "%";
const dateNZ = (d) =>
  (d ? new Date(d) : new Date()).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" });
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");

// ── low-level helpers ─────────────────────────────────────────
function registerFonts(doc) {
  const buf = fonts();
  for (const k of Object.keys(F)) doc.registerFont(F[k], buf[k]);
}

const accentGrad = (doc, x0, y0, x1, y1) =>
  doc.linearGradient(x0, y0, x1, y1).stop(0, C.accent).stop(1, C.accentDark);

/* SmartHomes mark (public/logo.svg, 44×44 box) at (x, y). */
function drawMark(doc, x, y, size) {
  const s = size / 44;
  doc.save().translate(x, y).scale(s);
  doc.roundedRect(0, 0, 44, 44, 14).fill(C.accent);
  doc.path("M12 28L22 18L32 28V34C32 35.1 31.1 36 30 36H14C12.9 36 12 35.1 12 34V28Z").fill(C.cream);
  doc.path("M18 36V28H26V36").fillOpacity(0.4).fill(C.accent).fillOpacity(1);
  doc.circle(22, 14, 2.5).fill(C.apricot);
  doc.restore();
  return x + size;
}

function wordmark(doc, x, y, size, color) {
  const end = drawMark(doc, x, y, size);
  doc.font(F.black).fontSize(size * 0.5).fillColor(color || C.ink)
    .text("SmartHomes", end + size * 0.28, y + size * 0.2, { characterSpacing: -0.3, lineBreak: false });
}

function svgStroke(doc, d, x, y, scale, color, lineWidth) {
  doc.save().translate(x, y).scale(scale);
  doc.lineWidth((lineWidth || 1.5) / scale).lineJoin("round").lineCap("round");
  doc.path(d).stroke(color);
  doc.restore();
}

function softShadow(doc, x, y, w, h, r) {
  doc.save().fillOpacity(0.07).roundedRect(x + 1.5, y + 5, w, h, r).fill(C.ink).restore();
}

function eyebrow(doc, text, x, y, color) {
  doc.font(F.bold).fontSize(9.5).fillColor(color || C.accent)
    .text(text.toUpperCase(), x, y, { characterSpacing: 1 });
}

function heading(doc, text, y) {
  doc.font(F.black).fontSize(23).fillColor(C.ink).text(text, M, y, { width: CW, characterSpacing: -0.5 });
  return y + doc.heightOfString(text, { width: CW, characterSpacing: -0.5 });
}

function para(doc, text, y, opts = {}) {
  const o = { width: opts.width || CW - 40, lineGap: 3 };
  doc.font(F.med).fontSize(opts.size || 10.5).fillColor(opts.color || C.inkMuted).text(text, opts.x ?? M, y, o);
  return y + doc.heightOfString(text, o);
}

/* Running header + footer on content pages. */
function chrome(doc, n) {
  doc.rect(0, 0, PW, PH).fill(C.white);
  wordmark(doc, M, M - 8, 20);
  doc.font(F.semi).fontSize(9.5).fillColor(C.inkSoft)
    .text(`Page ${n} of ${PAGES}`, M, M - 3, { width: CW, align: "right" });
  const fy = PH - 46;
  doc.moveTo(M, fy).lineTo(PW - M, fy).lineWidth(1).strokeColor(C.hairline).stroke();
  doc.font(F.med).fontSize(8).fillColor(C.inkSoft)
    .text("Indicative appraisal only — not a guarantee of income.", M, fy + 9);
  doc.font(F.med).fontSize(8).fillColor(C.inkSoft)
    .text(`SmartHomes · ${COMPANY.web}`, M, fy + 9, { width: CW, align: "right" });
}

/* Small uppercase label + big value. */
function statTile(doc, x, y, w, h, label, value, opts = {}) {
  if (opts.dark) doc.roundedRect(x, y, w, h, 14).fill(C.cardDark);
  else doc.roundedRect(x, y, w, h, 14).lineWidth(1).fillAndStroke(opts.bg || C.white, opts.border || C.border);
  doc.font(F.bold).fontSize(7.5).fillColor(opts.dark ? C.onDarkMuted : opts.labelColor || C.inkSoft)
    .text(label.toUpperCase(), x + 14, y + 14, { width: w - 28, characterSpacing: 0.5 });
  doc.font(F.black).fontSize(opts.valueSize || 17)
    .fillColor(opts.valueColor || (opts.dark ? C.apricot : C.ink))
    .text(value, x + 14, y + 29, { width: w - 28, characterSpacing: -0.4, lineBreak: false, ellipsis: true });
  if (opts.sub) {
    doc.font(F.med).fontSize(8).fillColor(opts.dark ? C.onDarkMuted : C.inkSoft)
      .text(opts.sub, x + 14, y + h - 19, { width: w - 28, lineBreak: false, ellipsis: true });
  }
}

function tileRow(doc, y, h, tiles) {
  const gap = 12;
  const w = (CW - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach(([label, value, opts], i) => statTile(doc, M + i * (w + gap), y, w, h, label, value, opts));
  return y + h;
}

// ─────────────────────────────────────────────────────────────
// PAGE 1 — COVER
// ─────────────────────────────────────────────────────────────
function coverPage(doc, lead, a) {
  doc.rect(0, 0, PW, PH).fill(C.cream);

  // Warm architectural shapes, top right: overlapping arcs in the palette.
  doc.save();
  doc.circle(PW - 40, 150, 210).fill(C.papaya);
  doc.circle(PW + 30, 60, 170).fill(C.apricot);
  doc.fillOpacity(0.55).circle(PW - 150, 250, 70).fill(C.peach);
  doc.restore();

  wordmark(doc, M, 50, 34);

  // headline
  let y = 300;
  eyebrow(doc, "Rental Appraisal", M, y);
  y += 26;
  doc.font(F.black).fontSize(44).fillColor(C.ink).text("What your property", M, y, { characterSpacing: -1.8 });
  y += 50;
  doc.font(F.black).fontSize(44).fillColor(C.accent).text("could earn.", M, y, { characterSpacing: -1.2 });

  // prepared-for block
  y += 74;
  doc.font(F.med).fontSize(10.5).fillColor(C.inkMuted).text("Prepared for", M, y);
  y += 16;
  doc.font(F.bold).fontSize(16).fillColor(C.ink).text(lead.name || "—", M, y, { width: CW });
  y += doc.heightOfString(lead.name || "—", { width: CW }) + 20;

  const col2 = M + 300;
  doc.font(F.bold).fontSize(8.5).fillColor(C.inkSoft).text("PROPERTY", M, y, { characterSpacing: 0.6 });
  doc.font(F.bold).fontSize(8.5).fillColor(C.inkSoft).text("PREPARED", col2, y, { characterSpacing: 0.6 });
  y += 14;
  doc.font(F.semi).fontSize(11).fillColor(C.ink)
    .text(lead.formatted_address || "Address to be confirmed", M, y, { width: 270, lineGap: 2 });
  doc.font(F.semi).fontSize(11).fillColor(C.ink).text(dateNZ(), col2, y, { width: 200 });

  // headline figure card
  const cardH = 108;
  const cardY = PH - 168;
  softShadow(doc, M, cardY, CW, cardH, 22);
  doc.roundedRect(M, cardY, CW, cardH, 22).fill(C.cardDark);
  doc.font(F.bold).fontSize(8.5).fillColor(C.onDarkMuted)
    .text("ESTIMATED SHORT-STAY INCOME", M + 28, cardY + 26, { characterSpacing: 0.6 });
  doc.font(F.black).fontSize(32).fillColor(C.apricot)
    .text(money(a.strNet), M + 28, cardY + 42, { characterSpacing: -1, lineBreak: false });
  const figW = doc.widthOfString(money(a.strNet), { characterSpacing: -1 });
  doc.font(F.bold).fontSize(12).fillColor(C.onDark)
    .text("/ year, net", M + 28 + figW + 8, cardY + 60, { lineBreak: false });

  const rx = M + CW - 28 - 170;
  doc.font(F.bold).fontSize(8.5).fillColor(C.onDarkMuted)
    .text("VS LONG-TERM RENTAL", rx, cardY + 26, { width: 170, align: "right", characterSpacing: 0.6 });
  doc.font(F.black).fontSize(20).fillColor(a.diff >= 0 ? C.apricot : C.onDark)
    .text(signedMoney(a.diff), rx, cardY + 44, { width: 170, align: "right", characterSpacing: -0.5 });
  doc.font(F.semi).fontSize(9.5).fillColor(C.onDark)
    .text(`${a.diff >= 0 ? "+" : ""}${pct0(a.upliftPct)} a year`, rx, cardY + 70, { width: 170, align: "right" });
}

// ─────────────────────────────────────────────────────────────
// PAGE 2 — AT A GLANCE
// ─────────────────────────────────────────────────────────────
function glancePage(doc, lead, a) {
  chrome(doc, 2);
  let y = M + 40;
  eyebrow(doc, "Your appraisal at a glance", M, y);
  y = heading(doc, "Short-stay vs long-term, side by side", y + 18) + 10;
  y = para(
    doc,
    `We compared what ${lead.formatted_address ? "your property" : "the property"} could earn as a professionally managed short-stay home against a standard long-term tenancy, using current market evidence for similar homes nearby.`,
    y
  ) + 18;

  // property facts
  const scenario = lead.scenario === "new" ? "Not rented" : lead.scenario === "rented" ? "Rented" : "—";
  y = tileRow(doc, y, 56, [
    ["Bedrooms", lead.bedrooms != null ? String(lead.bedrooms) : "—", { bg: C.cream, valueSize: 15 }],
    ["Property type", cap(lead.dwelling_type) || "—", { bg: C.cream, valueSize: 15 }],
    ["Currently", scenario, { bg: C.cream, valueSize: 15 }],
    ["Current rent", lead.current_weekly_rent ? money(lead.current_weekly_rent) + "/wk" : "—", { bg: C.cream, valueSize: 15 }],
  ]) + 18;

  // comparison card
  const cmpH = 132;
  const half = CW / 2;
  doc.roundedRect(M, y, CW, cmpH, 18).lineWidth(1).fillAndStroke(C.white, C.border);
  doc.roundedRect(M + half, y, half, cmpH, 18).fill(C.cardDark);
  doc.rect(M + half, y, 18, cmpH).fill(C.cardDark); // square off the seam

  doc.font(F.bold).fontSize(8.5).fillColor(C.inkSoft)
    .text("LONG-TERM RENTAL", M + 24, y + 22, { characterSpacing: 0.6 });
  doc.font(F.black).fontSize(28).fillColor(C.inkMuted)
    .text(money(a.ltrAnnual), M + 24, y + 40, { characterSpacing: -1 });
  doc.font(F.semi).fontSize(9.5).fillColor(C.inkSoft)
    .text(`${money(a.weeklyRent)}/wk × 52 weeks`, M + 24, y + 78);
  doc.font(F.med).fontSize(8.5).fillColor(C.inkSoft).text("Gross, per year", M + 24, y + cmpH - 26);

  const nx = M + half + 26;
  doc.font(F.bold).fontSize(8.5).fillColor(C.onDarkMuted)
    .text("SHORT-STAY WITH SMARTHOMES", nx, y + 22, { characterSpacing: 0.6 });
  doc.font(F.black).fontSize(28).fillColor(C.apricot)
    .text(money(a.strNet), nx, y + 40, { characterSpacing: -1 });
  doc.font(F.semi).fontSize(9.5).fillColor(C.onDark)
    .text(`About ${money(a.strWeekly)}/wk averaged over the year`, nx, y + 78, { width: half - 50 });
  doc.font(F.med).fontSize(8.5).fillColor(C.onDarkMuted)
    .text("Net of management & operating costs", nx, y + cmpH - 26);

  // arrow badge on the seam
  doc.circle(M + half, y + cmpH / 2, 15).fill(C.accent);
  svgStroke(doc, "M2 10 H18 M12 4 L18 10 L12 16", M + half - 7, y + cmpH / 2 - 7, 0.7, C.white, 2);
  y += cmpH + 14;

  // uplift banner
  const upH = 44;
  doc.save().roundedRect(M, y, CW, upH, 14).fill(C.papaya).restore();
  doc.font(F.bold).fontSize(11).fillColor(C.accentDark)
    .text(
      a.diff >= 0
        ? `Short-stay could earn ${money(a.diff)} more a year  (+${pct0(a.upliftPct)})`
        : `Long-term rental comes out ${money(a.diff)} a year ahead on these numbers`,
      M, y + 16, { width: CW, align: "center" }
    );
  y += upH + 22;

  // drivers
  doc.font(F.bold).fontSize(12).fillColor(C.ink).text("What drives the short-stay figure", M, y);
  y += 22;
  y = tileRow(doc, y, 70, [
    ["Nightly rate", money(a.nightlyRate), { sub: "Year-round average" }],
    ["Occupancy", pct0(a.occupancy * 100), { sub: `${a.nightsBooked} nights a year` }],
    ["Gross revenue", money(a.strGross), { sub: "Before costs" }],
    ["Costs & mgmt", pct0(a.costsPct), { sub: money(a.strCosts) + " a year" }],
  ]) + 18;

  // equation
  const eqH = 100;
  doc.roundedRect(M, y, CW, eqH, 18).lineWidth(1).stroke(C.border);
  doc.font(F.bold).fontSize(12).fillColor(C.ink).text("How we calculate your net short-stay income", M + 22, y + 18);
  const parts = [
    { label: "NIGHTLY RATE", val: money(a.nightlyRate) },
    { op: "×" },
    { label: "NIGHTS BOOKED", val: String(a.nightsBooked) },
    { op: "-" },
    { label: "COSTS & MGMT", val: money(a.strCosts) },
    { op: "=" },
    { label: "NET PER YEAR", val: money(a.strNet), dark: true },
  ];
  const chipW = 100, chipH = 46, opW = 22, chipY = y + 42;
  const totalW = parts.reduce((s, p) => s + (p.op ? opW : chipW), 0);
  let cx = M + (CW - totalW) / 2;
  for (const p of parts) {
    if (p.op) {
      doc.font(F.bold).fontSize(15).fillColor(C.inkSoft).text(p.op, cx, chipY + 14, { width: opW, align: "center" });
      cx += opW;
      continue;
    }
    if (p.dark) doc.roundedRect(cx, chipY, chipW, chipH, 11).fill(C.cardDark);
    else doc.roundedRect(cx, chipY, chipW, chipH, 11).lineWidth(1).fillAndStroke(C.cream, C.border);
    doc.font(F.bold).fontSize(6.8).fillColor(p.dark ? C.onDarkMuted : C.inkSoft)
      .text(p.label, cx + 6, chipY + 9, { width: chipW - 12, align: "center", characterSpacing: 0.3 });
    doc.font(F.black).fontSize(12.5).fillColor(p.dark ? C.apricot : C.ink)
      .text(p.val, cx + 6, chipY + 23, { width: chipW - 12, align: "center", characterSpacing: -0.3 });
    cx += chipW;
  }
}

// ─────────────────────────────────────────────────────────────
// PAGE 3 — FIVE-YEAR OUTLOOK
// ─────────────────────────────────────────────────────────────
function outlookPage(doc, lead, a) {
  chrome(doc, 3);
  let y = M + 40;
  eyebrow(doc, "Five-year outlook", M, y);
  y = heading(doc, `${money(a.fiveYearDiff)} ${a.fiveYearDiff >= 0 ? "more" : "less"} over five years`, y + 18) + 10;
  y = para(
    doc,
    `Projected with short-stay income growing ${a.strGrowthPct.toFixed(1)}% a year and long-term rent growing ${a.ltrGrowthPct.toFixed(1)}% a year, in line with recent New Zealand trends.`,
    y
  ) + 16;

  // grouped bar chart
  const chH = 220;
  doc.roundedRect(M, y, CW, chH, 18).lineWidth(1).stroke(C.border);
  doc.font(F.bold).fontSize(12).fillColor(C.ink).text("Income by year", M + 22, y + 18);
  const lgY = y + 21;
  doc.roundedRect(M + CW - 200, lgY, 8, 8, 2).fill(C.ltr);
  doc.font(F.med).fontSize(8.5).fillColor(C.inkMuted).text("Long-term rental", M + CW - 188, lgY - 1);
  doc.roundedRect(M + CW - 100, lgY, 8, 8, 2).fill(C.accent);
  doc.font(F.med).fontSize(8.5).fillColor(C.inkMuted).text("Short-stay (net)", M + CW - 88, lgY - 1);
  drawBars(doc, M + 16, y + 48, CW - 36, chH - 64, a.years);
  y += chH + 16;

  // year table
  const rowH = 24;
  const cols = [
    { h: "Year", w: 0.16, align: "left" },
    { h: "Long-term rental", w: 0.28, align: "right" },
    { h: "Short-stay (net)", w: 0.28, align: "right" },
    { h: "Difference", w: 0.28, align: "right" },
  ];
  const tableX = M + 18, tableW = CW - 36;
  const cell = (text, i, ty, font, color) => {
    const x0 = tableX + cols.slice(0, i).reduce((s, c) => s + c.w * tableW, 0);
    doc.font(font).fontSize(9.5).fillColor(color)
      .text(text, x0, ty + 7, { width: cols[i].w * tableW, align: cols[i].align, lineBreak: false });
  };
  const tableH = rowH * (a.years.length + 2) + 8;
  doc.roundedRect(M, y, CW, tableH, 18).lineWidth(1).stroke(C.border);
  let ty = y + 4;
  cols.forEach((c, i) => cell(c.h.toUpperCase(), i, ty, F.bold, C.inkSoft));
  ty += rowH;
  for (const r of a.years) {
    doc.moveTo(tableX, ty).lineTo(tableX + tableW, ty).lineWidth(1).strokeColor(C.hairline).stroke();
    cell(`Year ${r.year}`, 0, ty, F.semi, C.ink);
    cell(money(r.ltr), 1, ty, F.med, C.inkMuted);
    cell(money(r.str), 2, ty, F.semi, C.ink);
    cell(signedMoney(r.diff), 3, ty, F.bold, r.diff >= 0 ? C.accentDark : C.inkMuted);
    ty += rowH;
  }
  doc.roundedRect(tableX - 8, ty + 1, tableW + 16, rowH - 2, 8).fill(C.papaya);
  cell("5 years", 0, ty, F.black, C.ink);
  cell(money(a.fiveYearLtr), 1, ty, F.bold, C.inkMuted);
  cell(money(a.fiveYearStr), 2, ty, F.black, C.ink);
  cell(signedMoney(a.fiveYearDiff), 3, ty, F.black, a.fiveYearDiff >= 0 ? C.accentDark : C.inkMuted);
  y += tableH + 16;

  // our view (admin commentary) or the evidence behind the numbers
  const commentary = String(lead.report_commentary || "").trim();
  const e = lead.estimate || {};
  const evidence = [
    e.comparablesFound != null ? `${e.comparablesFound} comparable listings reviewed` : null,
    e.confidence != null ? `${e.confidence}% model confidence` : null,
    e.source === "locality" ? "suburb-level market data" : e.source ? "address-level market analysis" : null,
    a.overridden ? "figures reviewed and adjusted by our team" : null,
  ].filter(Boolean);

  const title = commentary ? "Our view" : "Behind the numbers";
  const body = commentary ||
    (evidence.length
      ? `This appraisal is based on ${evidence.join(", ")}. Your property manager will walk through the comparables with you.`
      : "Figures reflect current market evidence for similar homes nearby and will be confirmed at your on-site assessment.");
  const bodyOpts = { width: CW - 48, lineGap: 3 };
  const room = PH - 60 - y - 48;
  doc.font(F.med).fontSize(10);
  const bodyH = Math.min(doc.heightOfString(body, bodyOpts), room);
  const boxH = 44 + bodyH + 18;
  doc.save().roundedRect(M, y, CW, boxH, 18).clip();
  doc.rect(M, y, CW, boxH).fill(C.cream);
  doc.rect(M, y, 5, boxH).fill(C.accent);
  doc.restore();
  doc.font(F.bold).fontSize(12).fillColor(C.ink).text(title, M + 24, y + 18);
  doc.font(F.med).fontSize(10).fillColor(C.inkMuted)
    .text(body, M + 24, y + 42, { ...bodyOpts, height: bodyH, ellipsis: true });
}

function drawBars(doc, x, y, w, h, years) {
  const padL = 40, padB = 20, padT = 6;
  const pw = w - padL, ph = h - padB - padT;
  const max = Math.max(...years.flatMap((r) => [r.str, r.ltr]), 1);
  const step = max > 60000 ? 20000 : max > 30000 ? 10000 : 5000;
  const top = Math.ceil(max / step) * step;
  const sy = (v) => y + padT + ph - (v / top) * ph;

  for (let v = 0; v <= top; v += step) {
    const gy = sy(v);
    doc.moveTo(x + padL, gy).lineTo(x + w, gy).lineWidth(1).strokeColor(C.hairline).stroke();
    doc.font(F.med).fontSize(7.5).fillColor(C.inkSoft).text(moneyK(v), x, gy - 4, { width: padL - 8, align: "right" });
  }

  const slot = pw / years.length;
  const bw = Math.min(26, slot * 0.28);
  years.forEach((r, i) => {
    const cx = x + padL + slot * i + slot / 2;
    const lh = Math.max(3, (r.ltr / top) * ph);
    const shh = Math.max(3, (r.str / top) * ph);
    doc.roundedRect(cx - bw - 2, sy(0) - lh, bw, lh, 5).fill(C.ltr);
    doc.roundedRect(cx + 2, sy(0) - shh, bw, shh, 5).fill(accentGrad(doc, 0, sy(0), 0, sy(0) - shh));
    doc.font(F.semi).fontSize(8).fillColor(C.inkMuted).text(`Year ${r.year}`, cx - 30, y + h - 12, { width: 60, align: "center" });
  });
}

// ─────────────────────────────────────────────────────────────
// PAGE 4 — WHY SMARTHOMES & NEXT STEPS
// ─────────────────────────────────────────────────────────────
function nextStepsPage(doc, lead, a) {
  chrome(doc, 4);
  let y = M + 40;
  eyebrow(doc, "Why SmartHomes", M, y);
  y = heading(doc, "We run it. You keep the upside.", y + 18) + 10;
  y = para(
    doc,
    "Local, full-service short-stay management across New Zealand: listing, pricing, guests, cleaning and maintenance, all handled, with a clear monthly owner statement.",
    y
  ) + 18;

  // Claims mirror the site's #process section; keep the two in step.
  const tiles = [
    { icon: "M3 14 L8 9 L11 12 L17 5 M13 5 H17 V9", title: "Dynamic pricing", body: "Nightly rates updated daily for demand, events and season, so you are never under-priced." },
    { icon: "M4 11 V9 A6 6 0 0 1 16 9 V11 M4 11 H6 V15 H4 Z M14 11 H16 V15 H14 Z", title: "24/7 NZ-based support", body: "Guest messages, check-ins and issues handled around the clock by our local team." },
    { icon: "M4 4 H16 V16 H4 Z M4 8 H16 M8 4 V16", title: "Hotel-grade turnovers", body: "Professional cleaning, linen and restocking between every stay, plus quarterly maintenance checks." },
    { icon: "M4 15 V9 M8 15 V5 M12 15 V11 M16 15 V7", title: "Paid monthly", body: "Payouts on the 5th, a clear statement, a live owner dashboard and a year-end tax pack." },
  ];

  const gap = 14;
  const tw = (CW - gap) / 2;
  const th = 92;
  tiles.forEach((t, i) => {
    const tx = M + (i % 2) * (tw + gap);
    const ty = y + Math.floor(i / 2) * (th + gap);
    doc.roundedRect(tx, ty, tw, th, 18).fill(C.cream);
    doc.roundedRect(tx + 18, ty + 18, 38, 38, 12).fill(C.apricot);
    svgStroke(doc, t.icon, tx + 27, ty + 27, 1, C.accentDark, 1.6);
    doc.font(F.bold).fontSize(12.5).fillColor(C.ink).text(t.title, tx + 70, ty + 20, { width: tw - 86 });
    doc.font(F.med).fontSize(9).fillColor(C.inkMuted).text(t.body, tx + 70, ty + 38, { width: tw - 86, lineGap: 2 });
  });
  y += (th + gap) * 2 + 4;

  // next steps
  eyebrow(doc, "Next steps: keys to first payout in 14 days", M, y);
  y += 20;
  const steps = [
    ["Free assessment", "A specialist visits, confirms these numbers and walks you through the proposal."],
    ["Property setup", "Photos, smart lock, linen and a deep clean. Listed on 6+ platforms in 7 days."],
    ["You get paid", `Monthly payouts on the 5th: about ${money(a.strWeekly)} a week on this appraisal.`],
  ];
  const sw = (CW - gap * 2) / 3;
  const sh = 116;
  steps.forEach(([title, body], i) => {
    const sx = M + i * (sw + gap);
    doc.roundedRect(sx, y, sw, sh, 18).lineWidth(1).stroke(C.border);
    doc.circle(sx + 32, y + 32, 13).fill(i === 2 ? C.cardDark : C.accent);
    doc.font(F.black).fontSize(11).fillColor(C.white).text(String(i + 1), sx + 19, y + 26, { width: 26, align: "center" });
    doc.font(F.bold).fontSize(12).fillColor(C.ink).text(title, sx + 18, y + 56, { width: sw - 36 });
    doc.font(F.med).fontSize(8.8).fillColor(C.inkMuted).text(body, sx + 18, y + 74, { width: sw - 36, lineGap: 2 });
  });
  y += sh + 14;

  // contact card
  const cH = 76;
  softShadow(doc, M, y, CW, cH, 20);
  doc.roundedRect(M, y, CW, cH, 20).fill(C.cardDark);
  drawMark(doc, M + 22, y + 18, 40);
  doc.font(F.bold).fontSize(14).fillColor(C.white).text("Book your free on-site assessment", M + 78, y + 22);
  doc.font(F.med).fontSize(9.5).fillColor(C.onDarkMuted).text("Reply to this report or get in touch directly", M + 78, y + 42);
  doc.font(F.bold).fontSize(11).fillColor(C.apricot).text(COMPANY.phone, M, y + 22, { width: CW - 24, align: "right" });
  doc.font(F.med).fontSize(10).fillColor(C.onDark).text(COMPANY.email, M, y + 42, { width: CW - 24, align: "right" });
  y += cH + 14;

  // disclaimer, sized to fit what's left
  const disc =
    "This appraisal is an estimate prepared from market data available at the date shown and does not guarantee any level of income. Short-stay revenue varies with seasonality, events, reviews, pricing strategy and wider travel demand. Costs & management covers our management fee, cleaning, linen, platform commission and consumables, but not rates, insurance, mortgage, body corporate or furnishing. Long-term rental figures are gross weekly rent before property management fees and vacancies. Short-stay use may require council consent or be restricted by your body corporate, lender or insurer, and income is taxable. We recommend independent tax and legal advice before changing how your property is used.";
  const dOpts = { width: CW - 40, lineGap: 2.5 };
  doc.font(F.med).fontSize(7.8);
  const dH = 34 + doc.heightOfString(disc, dOpts) + 14;
  doc.roundedRect(M, y, CW, dH, 14).lineWidth(1).fillAndStroke(C.cream, C.border);
  doc.font(F.bold).fontSize(8).fillColor(C.inkMuted).text("IMPORTANT INFORMATION", M + 20, y + 14, { characterSpacing: 0.6 });
  doc.font(F.med).fontSize(7.8).fillColor(C.inkSoft).text(disc, M + 20, y + 30, dOpts);
}

// ─────────────────────────────────────────────────────────────

/**
 * Render a lead's appraisal as a PDF.
 * @returns {Promise<Buffer|null>} null when the lead lacks the figures to price it
 */
export function generateAppraisalPdf(lead) {
  const a = computeAppraisal(lead, CALC);
  if (!a) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: {
        Title: `Rental appraisal — ${lead.formatted_address || lead.name}`,
        Author: COMPANY.name,
        Subject: "Short-stay vs long-term rental appraisal",
      },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerFonts(doc);
    coverPage(doc, lead, a);
    doc.addPage();
    glancePage(doc, lead, a);
    doc.addPage();
    outlookPage(doc, lead, a);
    doc.addPage();
    nextStepsPage(doc, lead, a);
    doc.end();
  });
}
