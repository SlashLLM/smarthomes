# SmartHomes — Roadmap

Three workstreams: **(A)** port the site to the "Warm Architectural" redesign,
**(B)** admin portal for leads and appraisal reports sent through Resend, and
**(C)** SEO, performance, and cleanup. **(A)** and **(C)** overlap, so ship the SEO
fixes as part of the redesign rather than twice.

Design source: `Downloads/stitch_smarthomes_warm_redesign_vanilla/main.html`
(tokens in `DESIGN.md`; report styling in `design-canvas/OwnerAnnualReport.dc.html`).

---

## A. Redesign: port `main.html` into the live site

The Stitch export is a prototype. It loads Tailwind from the CDN, its calculator
uses inline hard-coded maths, and its forms go nowhere. Take the markup and
styling from it, and keep the current site's working logic.

### A1. Build setup
- [x] Add Tailwind as a real build dependency (`tailwindcss` + PostCSS in Vite). Drop `cdn.tailwindcss.com`, because the CDN build is not for production: it is slow and causes FOUC and CLS
- [x] Move the `tailwind.config` from the inline `<script>` into `tailwind.config.js` (the `brand.*` colours plus the `wavy`/`scallop`/`super` radii)
- [ ] Reconcile the `brand.*` palette in `main.html` with the Material tokens in `DESIGN.md` and pick one source of truth
- [x] Fonts: change from Newsreader, Geist, and JetBrains Mono to **Plus Jakarta Sans**. Self-host it or keep Google Fonts with `display=swap` and preload the weights actually used
- [x] Material Symbols: subset the icon font to the glyphs in use (`&icon_names=`) or swap in inline SVGs. The full variable font is about 3 MB
- [x] GSAP: install from npm (bundled) or keep the cdnjs version with SRI

### A2. Page sections (map old to new)
| New section (`main.html`) | Replaces (`index.html`) | Notes |
|---|---|---|
| `#intro-film` intro | — (new) | Must not block LCP or hide content from crawlers (see C2) |
| header / `#siteNav` | `.nav` | Add a mobile menu. The new nav is `hidden md:flex` only, so phones have no nav |
| hero + `#calculator` | `.hero--v2` | **Wire it to the real API** (A3) |
| — | `.trust` strip | Decide whether to keep it. The new design drops it |
| `#process` | `#how` | |
| `#results` | `#results` | Reuse the existing `assets/case-*.png` and keep the alt text |
| `#faq` | `#faq` | Keep the Q&A text in sync with the FAQPage JSON-LD |
| `#free-assessment` | `#assess` | Wire it to `/api/lead` with `source: "assessment"` |
| footer | `.foot` | Replace the 8 dead `href="#"` links with real ones or remove them |

- [x] Replace inline `onclick=` handlers with module JS in `app.js`
- [x] Wire or delete the `editorial-split.html` link
- [x] Carry over the `<head>` from `index.html` (meta, OG, JSON-LD). `main.html` has none of it and `lang="en"` should be `en-NZ`
- [x] Decide what happens to the current scroll-video hero (`scrub-engine.js`, `assets/vid/*`). The new design replaces it with the photo intro film

### A3. Calculator wiring (highest risk)
- [x] `#propertyAddress`: connect to `/api/places/autocomplete` and `/api/places/details`, and remove the hard-coded default value
- [x] Bedrooms, type (House/Apt/Flat), and mode toggle: map to the existing `bedrooms`, `dwellingType`, and `scenario` params. Check that "Flat" maps to a valid dwelling type in `api/_lib/config.js`
- [x] `autoMarketRent()` and `calculateYield()`: replace the stub maths with `/api/estimate` and the existing projection code
- [x] Carry over the loading, error, and "suburb-level estimate" fallback states
- [x] `submitProjection()` (unlock teaser form): POST to `/api/lead` with the estimate and projection attached

### A4. QA
- [x] Test at mobile widths (375 and 414) and check for horizontal overflow
- [x] Respect `prefers-reduced-motion` for the intro film and GSAP
- [ ] Accessibility: focus states, labels on every input, FAQ accordion `aria-expanded`, colour contrast (`inkSoft #8F7D73` on cream is likely below 4.5:1)
- [ ] Check Lighthouse before and after, aiming for 90+ on mobile Performance, SEO, and A11y

---

## B. Admin portal: leads and appraisal reports

### B1. Auth and data access
**Decided:** shared `ADMIN_PASSWORD` from env, with a signed HttpOnly session cookie and the service role key used only in `api/admin/*` (`api/_lib/admin.js`). The Supabase Auth plan below is superseded, but still worth revisiting if more than one person needs access or per-user audit is wanted.

The current security model is deliberate: `api/` uses the **anon key**, and leads
**cannot be read back** because no RPC exists for it. The admin portal must not
weaken that for the public endpoints.

Recommended approach:
- [ ] **Supabase Auth** (magic link or email+password) for admins, with signups disabled
- [ ] `admins` table (`user_id`) and an `is_admin()` SQL helper
- [ ] New `security definer` RPCs that check `is_admin()` and are granted to `authenticated` only (never `anon`): `admin_list_leads`, `admin_get_lead`, `admin_update_lead_status`, `admin_upsert_report`, `admin_list_reports`, `admin_mark_report_sent`
- [ ] Admin API routes under `api/admin/*` forward the user's JWT to Supabase, so the RPCs run as that user. **No service role key in Vercel**
- [x] Migration `0003_admin.sql` (status/notes/source/preferred_time columns; `insert_lead` stores source)

The alternative is a service role key with a shared admin password. It is simpler, but a leaked key would expose everything, so it is not recommended.

### B2. Leads dashboard (`/admin`)
- [x] Login page
- [x] Leads table: date, name, email, phone, address, source (calculator/assessment), estimate summary, status
- [x] Filters: status, source, date range, search
- [x] Lead detail view showing the full estimate and projection JSON rendered readably
- [x] Status pipeline: `new → contacted → report_sent → won / lost`, plus free-text notes. Needs new `status`, `notes`, and `source` columns on `leads`. `source` is currently only passed to the email and never stored
- [x] CSV export
- [x] Exclude `/admin` from indexing (`noindex` plus a `robots.txt` Disallow)

### B3. Appraisal reports
**Shipped (wealthify-style PDF):** migration `0004_appraisal_report.sql` adds `report_*` override columns on `leads`; the lead drawer edits them with a live preview; `api/admin/report.js` renders a 4-page branded A4 PDF with pdfkit (`api/_lib/pdf-report.js`, maths in `shared/appraisal.js`) for preview or download. The items below cover the later hosted/emailed version.
- [ ] `appraisal_reports` table: `id`, `lead_id`, `status` (draft/sent), editable fields (market rent, nightly rate, occupancy, 12-month and 5-year projections, comparables, commentary, recommended management fee), `public_token`, `sent_at`, `resend_email_id`, `opened_at`
- [ ] "Create report" on a lead pre-fills from the lead's stored `estimate`/`projection`. The admin can edit it, or re-run `/api/estimate` for fresh numbers
- [ ] Report template in the warm design, based on `OwnerAnnualReport.dc.html`
- [ ] Hosted report page at `/report/<token>` (unguessable token, read via a token-checked RPC, `noindex`). The email links to it
- [x] Optional PDF download (server-side render or print stylesheet)
- [x] Preview before sending

### B4. Sending with Resend
- [ ] `api/admin/reports/send.js`: send the report email to the lead's address, then stamp `sent_at` and `resend_email_id`
- [ ] Email template as table-based inline-CSS HTML plus a plain-text version. Could use `react-email`, or reuse the `escapeHtml`/`row` helpers from `api/lead.js`
- [ ] New env var `REPORT_FROM_EMAIL` (verified domain) and a `replyTo` pointing at the account manager
- [ ] Resend webhook (`api/resend-webhook.js`, signature-verified) for delivered, opened, bounced, and complained events, stored on the report
- [ ] Rate-limit and idempotency-guard sends so a double-click can't send two emails
- [ ] Also send an auto-reply confirmation to the lead on form submit, if wanted (it currently only notifies the internal inbox)

---

## C. SEO, performance, and cleanup

### C1. Fix now (hurting the current site)
- [x] **Remove the React *development* builds and Babel standalone from production** (`index.html:838-842`, used for the tweaks panel). That is about 1 MB+ of JS compiling JSX in the browser. Load it only in dev or behind `?tweaks=1`
- [x] `SmartHomes.html` is a near-duplicate of the homepage and gets deployed, which is a duplicate-content risk. Delete it or redirect it
- [x] Duplicate `robots.txt` and `sitemap.xml` at the repo root and in `public/`. Keep only `public/`
- [x] `public/tweaks*.jsx` are shipped publicly. Move them out of `public/`
- [x] The `AggregateRating` in JSON-LD must match real, visible reviews. Otherwise remove it, because Google treats fabricated ratings as a manual-action risk
- [x] Update the sitemap `lastmod` and generate it at build time
- [x] Remove the `meta keywords` tag (ignored) and check the `twitter:site` handle exists

### C2. Redesign-specific SEO
- [x] Keep exactly one `<h1>` and a logical h2/h3 order in the new markup
- [x] Render the intro film overlay without making the real content `display:none`/invisible to crawlers, and keep LCP on the hero image, not the film
- [x] Convert `hero-vacation-home.jpg` and the other JPGs and PNGs to AVIF/WebP with `srcset`, explicit `width`/`height`, and `fetchpriority="high"` on the LCP image
- [x] Put descriptive `alt` text on every image. The Stitch export uses `alt=""` in places
- [ ] New OG image in the new brand style

### C3. Growth SEO (new pages)
The site is currently one page, so it can only rank for a handful of terms.
- [ ] Location landing pages: `/locations/mount-maunganui`, `/queenstown`, `/auckland`, `/tauranga`, `/coromandel`, and so on, each with local stats, a case study, FAQ, and `LocalBusiness`/`Service` schema. The suburb data in `locality_stats` could feed real numbers here
- [ ] Case study pages (`/results/hahei-bach`, …) with `Article` schema
- [ ] Guides/blog: "Airbnb vs long-term rental NZ", "bright-line test and holiday homes", "council short-stay rules by region", and similar
- [ ] Standalone `/calculator` page targeting "Airbnb income calculator NZ"
- [ ] About/team page and a real NAP (name, address, phone) for E-E-A-T and Google Business Profile consistency
- [ ] Privacy policy and terms pages, needed anyway since we collect leads (NZ Privacy Act 2020)
- [x] Clean URLs in `vercel.json` (`cleanUrls: true`, `trailingSlash: false`), plus a custom 404

### C4. Measurement
- [ ] Google Search Console and Bing Webmaster: verify and submit the sitemap
- [ ] Analytics (Plausible, GA4, or Vercel Analytics) with conversion events for estimate run, lead submitted, and assessment booked
- [ ] Vercel Speed Insights for real-user Core Web Vitals
- [ ] Google Business Profile, linked from the site

### C5. Security and ops
- [ ] CSP header (the other security headers are in `vercel.json`): `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS
- [ ] Add CAPTCHA or Turnstile on the lead forms if spam appears (rate limiting exists already)
- [ ] Update the README for the admin portal, new env vars, and migration `0003`

---

## Suggested order
1. **C1** quick wins, on their own small PR
2. **A1 → A3**: redesign with the calculator wired (one branch, the largest piece of work)
3. **C2** alongside A4 QA, then ship the redesign
4. **B1 → B2**: admin auth and leads dashboard
5. **B3 → B4**: reports and Resend sending
6. **C3/C4**: content pages and measurement, ongoing
