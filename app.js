/* SmartHomes — calculator + general interactions */

(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const fmt = (n) => "$" + Math.round(n).toLocaleString("en-NZ");
  const pct = (n) => (n >= 0 ? "+" : "") + Math.round(n) + "%";

  // ---------- Mock address database (stand-in for Google Places + AI rent model) ----------
  const ADDRESS_DB = [
    { addr: "14 Marine Parade, Mount Maunganui", suburb: "Mount Maunganui", tier: 1.15, adr: 358, aiLTR: 920, occ: 0.83 },
    { addr: "22 Marine Parade, Mount Maunganui", suburb: "Mount Maunganui", tier: 1.15, adr: 345, aiLTR: 890, occ: 0.82 },
    { addr: "8 Beach Road, Mount Maunganui",     suburb: "Mount Maunganui", tier: 1.12, adr: 330, aiLTR: 860, occ: 0.81 },
    { addr: "5 Church Street, Queenstown",       suburb: "Queenstown CBD", tier: 1.30, adr: 412, aiLTR: 980, occ: 0.81 },
    { addr: "101 Shotover Street, Queenstown",   suburb: "Queenstown CBD", tier: 1.28, adr: 398, aiLTR: 950, occ: 0.80 },
    { addr: "45 Ponsonby Road, Auckland",        suburb: "Ponsonby, Auckland", tier: 1.05, adr: 305, aiLTR: 870, occ: 0.78 },
    { addr: "12 Jervois Road, Ponsonby, Auckland", suburb: "Ponsonby, Auckland", tier: 1.06, adr: 312, aiLTR: 880, occ: 0.78 },
    { addr: "3 Ardmore Street, Wānaka",           suburb: "Wānaka", tier: 1.18, adr: 385, aiLTR: 900, occ: 0.79 },
    { addr: "18 Roberts Street, Wānaka",          suburb: "Wānaka", tier: 1.16, adr: 372, aiLTR: 880, occ: 0.78 },
    { addr: "27 Oriental Parade, Wellington",     suburb: "Oriental Bay, Wellington", tier: 1.02, adr: 295, aiLTR: 820, occ: 0.74 },
    { addr: "9 Hahei Beach Road, Coromandel",     suburb: "Hahei, Coromandel", tier: 0.95, adr: 340, aiLTR: 760, occ: 0.71 },
  ];

  function filterAddresses(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    return ADDRESS_DB.filter(
      (a) => a.addr.toLowerCase().includes(q) || a.suburb.toLowerCase().includes(q)
    ).slice(0, 5);
  }

  // ---------- Steppers ----------
  $$("[data-stepper]").forEach((stp) => {
    stp.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-step]");
      if (!btn) return;
      const input = stp.querySelector("input");
      const cur = parseInt(input.value, 10) || 0;
      const delta = parseInt(btn.dataset.step, 10);
      input.value = Math.max(0, cur + delta);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  // ================================================================
  // Calculator factory — address lookup, AI market scan, projection
  // ================================================================
  function createCalculator(p, opts) {
    // p = id prefix, e.g. "fc"
    const els = {
      scenarioGroup: document.querySelector(`[data-scenario-group="${p}"]`),
      addr: $(`#${p}-addr`),
      addrList: $(`#${p}-addr-list`),
      rentWrap: $(`#${p}-rent-wrap`),
      rent: $(`#${p}-rent`),
      aiRow: $(`#${p}-ai-row`),
      scanBtn: $(`#${p}-scan-btn`),
      scanBtnLabel: $(`#${p}-scan-btn-label`),
      rescanBtn: $(`#${p}-rescan-btn`),
      aiLoading: $(`#${p}-ai-loading`),
      aiStep: $(`#${p}-ai-step`),
      aiBar: $(`#${p}-ai-bar`),
      aiResult: $(`#${p}-ai-result`),
      aiLabel: $(`#${p}-ai-label`),
      aiValue: $(`#${p}-ai-value`),
      aiConfidence: $(`#${p}-ai-confidence`),
      aiDelta: $(`#${p}-ai-delta`),
    };
    if (!els.addr) return null;

    const STEPS = {
      rented: [
        "Pulling comparable listings nearby…",
        "Cross-referencing 6 booking platforms…",
        "Modelling seasonal demand for this address…",
        "Finalising your market estimate…",
      ],
      new: [
        "Pulling comparable listings nearby…",
        "Analysing long-term rental comparables…",
        "Modelling demand for this address…",
        "Finalising your rent estimate…",
      ],
    };
    const STEP_MS = 550;

    let scenario = "rented"; // "rented" | "new"
    let selected = null; // chosen address record
    let aiRent = null; // resolved AI rent estimate (weekly)
    let aiTimer = null;
    let scanning = false;

    function setScenario(s) {
      scenario = s;
      els.scenarioGroup.querySelectorAll("button").forEach((b) =>
        b.classList.toggle("on", b.dataset.scenario === s)
      );
      if (els.rentWrap) els.rentWrap.hidden = s === "new";
      els.scanBtnLabel.textContent = s === "rented" ? "Get AI market rent" : "Get potential rent estimate";
      resetScan();
      if (opts.onResultsClear) opts.onResultsClear();
      updateScanButton();
    }

    els.scenarioGroup.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-scenario]");
      if (!b) return;
      setScenario(b.dataset.scenario);
    });

    function resetScan() {
      clearTimeout(aiTimer);
      scanning = false;
      aiRent = null;
      els.scanBtn.hidden = false;
      els.aiLoading.hidden = true;
      els.aiResult.hidden = true;
      els.aiBar.style.transition = "none";
      els.aiBar.style.width = "0%";
    }

    function updateScanButton() {
      const ready = !!selected && (scenario === "new" || parseInt(els.rent.value, 10) > 0);
      els.scanBtn.disabled = !ready || scanning;
    }

    // ---- autocomplete ----
    els.addr.addEventListener("input", () => {
      selected = null;
      resetScan();
      if (opts.onResultsClear) opts.onResultsClear();
      updateScanButton();
      const matches = filterAddresses(els.addr.value);
      if (!matches.length) {
        els.addrList.classList.remove("open");
        els.addrList.innerHTML = "";
        return;
      }
      els.addrList.innerHTML = matches
        .map(
          (m, i) =>
            `<div class="autocomplete__item" data-idx="${i}"><strong>${m.addr}</strong><span>${m.suburb}</span></div>`
        )
        .join("");
      els.addrList.classList.add("open");
      els.addrList.querySelectorAll(".autocomplete__item").forEach((item, i) => {
        item.addEventListener("click", () => {
          selected = matches[i];
          els.addr.value = selected.addr;
          els.addrList.classList.remove("open");
          resetScan();
          updateScanButton();
        });
      });
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(`#${p}-addr-list`) && e.target !== els.addr) {
        els.addrList.classList.remove("open");
      }
    });

    if (els.rent) {
      els.rent.addEventListener("input", () => {
        resetScan();
        updateScanButton();
      });
    }

    els.scanBtn.addEventListener("click", () => {
      if (els.scanBtn.disabled) return;
      maybeAnalyze();
    });
    if (els.rescanBtn) {
      els.rescanBtn.addEventListener("click", () => {
        if (scanning) return;
        maybeAnalyze();
      });
    }

    function maybeAnalyze() {
      if (!selected) return;
      if (scenario === "rented") {
        const typed = parseInt(els.rent.value, 10);
        if (!typed || typed <= 0) return;
        runAnalysis(
          () => Math.round(Math.max(typed * 1.35, selected.aiLTR) / 10) * 10,
          "Current market rent for this address"
        );
      } else {
        runAnalysis(() => selected.aiLTR, "Potential long-term rent for this address");
      }
    }

    function runAnalysis(computeFn, label) {
      clearTimeout(aiTimer);
      scanning = true;
      els.scanBtn.disabled = true;
      els.scanBtn.hidden = true;
      els.aiResult.hidden = true;
      els.aiLoading.hidden = false;

      const steps = STEPS[scenario];
      let i = 0;
      els.aiStep.textContent = steps[0];
      els.aiBar.style.transition = "none";
      els.aiBar.style.width = "0%";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          els.aiBar.style.transition = `width ${steps.length * STEP_MS}ms linear`;
          els.aiBar.style.width = "100%";
        });
      });

      const advance = () => {
        i++;
        if (i < steps.length) {
          els.aiStep.textContent = steps[i];
          aiTimer = setTimeout(advance, STEP_MS);
        } else {
          aiTimer = setTimeout(() => {
            aiRent = computeFn();
            els.aiLabel.textContent = label;
            els.aiValue.textContent = "$" + aiRent.toLocaleString("en-NZ") + "/wk";

            const confidence = Math.min(97, Math.round(88 + selected.tier * 6));
            const comparables = Math.round(9 + selected.tier * 6);
            els.aiConfidence.textContent = `${confidence}% confidence · ${comparables} comparables`;

            if (scenario === "rented") {
              const typed = parseInt(els.rent.value, 10);
              const deltaPct = Math.round(((aiRent - typed) / typed) * 100);
              els.aiDelta.hidden = false;
              if (deltaPct > 3) {
                els.aiDelta.textContent = `${deltaPct}% under market`;
                els.aiDelta.classList.add("good");
              } else if (deltaPct < -3) {
                els.aiDelta.textContent = `${Math.abs(deltaPct)}% over market`;
                els.aiDelta.classList.remove("good");
              } else {
                els.aiDelta.textContent = "At market rate";
                els.aiDelta.classList.remove("good");
              }
            } else {
              els.aiDelta.hidden = true;
            }

            els.aiLoading.hidden = true;
            els.aiResult.hidden = false;
            scanning = false;
            recalc();
          }, STEP_MS);
        }
      };
      aiTimer = setTimeout(advance, STEP_MS);
    }

    function recalc() {
      if (!selected || aiRent == null) return;
      const extra = opts.getExtras ? opts.getExtras() : { typeMult: 1, bathBonus: 0, sleeps: 6, bonusPct: 0 };
      const occ = Math.min(0.92, selected.occ + extra.bonusPct * 0.4);
      const adr = selected.adr * extra.typeMult * (1 + extra.bonusPct) * (0.9 + extra.sleeps * 0.015);
      const str = adr * 365 * occ * 0.82;
      const ltrAnnual = aiRent * 52;
      opts.onResult({ str, ltrAnnual, adr, occ, selected, scenario });
    }

    function selectAddress(record, rentValue) {
      selected = record;
      els.addr.value = record.addr;
      els.addrList.classList.remove("open");
      els.addrList.innerHTML = "";
      if (rentValue != null && els.rent) els.rent.value = rentValue;
      resetScan();
      updateScanButton();
    }

    return { setScenario, recalc, selectAddress, getState: () => ({ scenario, selected, aiRent }) };
  }

  // ---------- Calculator (hero card) ----------
  const fc = createCalculator("fc", {
    onResultsClear() {
      $("#calc-str").textContent = "—";
      $("#calc-ltr").textContent = "—";
      $("#calc-delta").textContent = "—";
      $("#calc-pct").textContent = "";
      $("#chart").innerHTML = "";
      $("#out-5str").textContent = "—";
      $("#out-5ltr").textContent = "—";
      $("#out-5diff").textContent = "—";
    },
    onResult({ str, ltrAnnual, scenario }) {
      const diff = str - ltrAnnual;
      const pctVal = ltrAnnual ? (diff / ltrAnnual) * 100 : 0;
      $("#calc-str").textContent = fmt(str);
      $("#calc-ltr").textContent = fmt(ltrAnnual);
      $("#calc-ltr-label").textContent =
        scenario === "rented" ? "Long-term rental / yr" : "Potential long-term / yr";
      $("#calc-delta").textContent = (diff >= 0 ? "+" : "") + fmt(diff);
      $("#calc-pct").textContent = pct(pctVal);

      // 5 year projection: STR grows 6%/yr, LTR 2.5%/yr
      let s5 = 0, l5 = 0;
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const sY = str * Math.pow(1.06, i);
        const lY = ltrAnnual * Math.pow(1.025, i);
        s5 += sY; l5 += lY;
        rows.push([sY, lY, i]);
      }
      $("#out-5str").textContent = fmt(s5);
      $("#out-5ltr").textContent = fmt(l5);
      $("#out-5diff").textContent = (s5 - l5 >= 0 ? "+" : "") + fmt(s5 - l5);

      const max = Math.max(...rows.flatMap((r) => [r[0], r[1]]));
      const chart = $("#chart");
      chart.innerHTML = rows
        .map(([s, l, i]) => {
          const sh = (s / max) * 100;
          const lh = (l / max) * 100;
          return `<div class="col"><div class="pair"><div class="bar bar--ltr" style="height:${lh}%"></div><div class="bar bar--str" style="height:${sh}%"></div></div><div class="label">Y${i + 1}</div></div>`;
        })
        .join("");
    },
  });

  // ---------- Lead-gate modal (gates the 5yr projection) ----------
  const modal = $("#lead-modal");
  const modalForm = $("#lead-modal-form");
  const modalThanks = $("#lead-modal-thanks");
  const projWrap = $("#proj-wrap");

  if (modal) {
    const openModal = () => {
      modal.hidden = false;
      modalForm.hidden = false;
      modalThanks.hidden = true;
    };
    const closeModal = () => { modal.hidden = true; };

    $("#proj-unlock-btn").addEventListener("click", openModal);
    $("#lead-modal-close").addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });
    $("#lead-submit").addEventListener("click", () => {
      modalForm.hidden = true;
      modalThanks.hidden = false;
      projWrap.classList.remove("locked");
    });
    $("#lead-modal-done").addEventListener("click", closeModal);
  }

  // ---------- Mobile Navigation Drawer ----------
  const navToggle = $("#nav-toggle");
  const navLinksContainer = $("#nav-links");

  if (navToggle && navLinksContainer) {
    function toggleNav(show) {
      const isOpen = show !== undefined ? show : !navLinksContainer.classList.contains("is-open");
      navLinksContainer.classList.toggle("is-open", isOpen);
      navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }

    navToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNav();
    });

    // Close when clicking nav link
    $$("a", navLinksContainer).forEach((link) => {
      link.addEventListener("click", () => toggleNav(false));
    });

    // Close when clicking outside header
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#nav")) {
        toggleNav(false);
      }
    });
  }

  // ---------- Mark current section in nav ----------
  const navLinks = $$(".nav__links a");
  const sections = navLinks
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          const id = "#" + e.target.id;
          navLinks.forEach((a) =>
            a.classList.toggle("on", a.getAttribute("href") === id)
          );
        }
      });
    },
    { rootMargin: "-40% 0px -55% 0px" }
  );
  sections.forEach((s) => io.observe(s));

  // ---------- Seed the calculator with a default address for a populated demo ----------
  if (fc) fc.selectAddress(ADDRESS_DB[0], 780);
})();
