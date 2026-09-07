/* SmartHomes — calculator + general interactions */

(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const fmt = (n) => "$" + Math.round(n).toLocaleString("en-NZ");
  const pct = (n) => (n >= 0 ? "+" : "") + Math.round(n) + "%";

  /* Mirrors api/_lib/config.js — keep the two in step. The server owns these for
     the estimate; the browser needs them for the projection maths. */
  const CALC = {
    STR_NET_FACTOR: 0.82, // owner's share of gross short-stay revenue after costs
    MAX_OCCUPANCY: 0.92,
    STR_GROWTH: 1.06,
    LTR_GROWTH: 1.025,
  };

  // ---------- Steppers ----------
  $$("[data-stepper]").forEach((stp) => {
    const min = Number(stp.dataset.min ?? 0);
    const max = Number(stp.dataset.max ?? Infinity);
    stp.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-step]");
      if (!btn) return;
      const input = stp.querySelector("input");
      const cur = parseInt(input.value, 10) || min;
      const delta = parseInt(btn.dataset.step, 10);
      input.value = Math.min(max, Math.max(min, cur + delta));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  // ================================================================
  // Address autocomplete — Google Places, proxied through /api/places
  // ================================================================
  /* Shared by the hero calculator and the assessment CTA. Owns the whole
   * typing session: debounce, suggestion list, keyboard nav, and the session
   * token that keeps Places on session pricing rather than per-keystroke.
   *
   * The host supplies the elements and two callbacks:
   *   onTyping()        the field was edited, so any resolved place is stale
   *   onResolve(place)  a details lookup settled — the place, or null on failure
   *   onHint(msg, err)  status line ("Looking up addresses…", errors)
   */
  function createAddressAutocomplete({ input, list, idPrefix, onTyping, onResolve, onHint }) {
    if (!input || !list) return null;

    const DEBOUNCE_MS = 250;
    const MIN_QUERY = 3;
    const prefix = idPrefix || input.id;
    const hint = (text, isError) => onHint && onHint(text, !!isError);

    let sessionToken = null;
    let suggestions = [];
    let activeIndex = -1;
    let suggestController = null;
    let debounceTimer = null;

    function closeList() {
      list.classList.remove("open");
      input.setAttribute("aria-expanded", "false");
      activeIndex = -1;
    }

    function renderSuggestions() {
      list.textContent = "";

      if (!suggestions.length) {
        const empty = document.createElement("div");
        empty.className = "autocomplete__empty";
        empty.textContent = "No matching addresses";
        list.append(empty);
      } else {
        suggestions.forEach((s, i) => {
          const item = document.createElement("div");
          item.className = "autocomplete__item";
          item.dataset.idx = String(i);
          item.setAttribute("role", "option");
          item.id = `${prefix}-opt-${i}`;

          // textContent, not innerHTML — these strings come from Google, not from
          // a hardcoded list, so interpolating them into markup would be an
          // injection vector.
          const strong = document.createElement("strong");
          strong.textContent = s.primary;
          const span = document.createElement("span");
          span.textContent = s.secondary;

          item.append(strong, span);
          list.append(item);
        });
      }

      list.classList.add("open");
      input.setAttribute("aria-expanded", "true");
      activeIndex = -1;
    }

    function highlight(next) {
      const items = $$(".autocomplete__item", list);
      if (!items.length) return;
      activeIndex = (next + items.length) % items.length;
      items.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
      input.setAttribute("aria-activedescendant", `${prefix}-opt-${activeIndex}`);
      items[activeIndex].scrollIntoView({ block: "nearest" });
    }

    async function fetchSuggestions(q) {
      if (suggestController) suggestController.abort();
      suggestController = new AbortController();

      // One session token spans the whole typing session and is retired by the
      // details call — that is what keeps Places on session pricing.
      if (!sessionToken) sessionToken = crypto.randomUUID();

      try {
        const url = `/api/places/autocomplete?q=${encodeURIComponent(q)}&session=${sessionToken}`;
        const res = await fetch(url, { signal: suggestController.signal });
        const data = await res.json();

        if (!res.ok) {
          hint(
            data.error === "not_configured"
              ? "Address lookup isn't configured yet."
              : "Address lookup is unavailable right now.",
            true
          );
          closeList();
          return;
        }

        hint("");
        suggestions = data.predictions || [];
        renderSuggestions();
      } catch (err) {
        if (err.name === "AbortError") return;
        hint("Address lookup is unavailable right now.", true);
        closeList();
      }
    }

    input.addEventListener("input", () => {
      if (onTyping) onTyping();
      clearTimeout(debounceTimer);

      const q = input.value.trim();
      if (q.length < MIN_QUERY) {
        if (suggestController) suggestController.abort();
        closeList();
        hint("");
        return;
      }

      hint("Looking up addresses…");
      debounceTimer = setTimeout(() => fetchSuggestions(q), DEBOUNCE_MS);
    });

    async function choose(index) {
      const pick = suggestions[index];
      if (!pick) return;

      input.value = [pick.primary, pick.secondary].filter(Boolean).join(", ");
      closeList();
      hint("Confirming address…");

      let place = null;
      try {
        const url = `/api/places/details?placeId=${encodeURIComponent(pick.placeId)}&session=${sessionToken || ""}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "lookup failed");

        place = data.place;
        input.value = place.formattedAddress || input.value;
        hint("");
      } catch {
        place = null;
        hint("We couldn't confirm that address. Try selecting it again.", true);
      } finally {
        sessionToken = null; // the session ends with the details call
        if (onResolve) onResolve(place);
      }
    }

    list.addEventListener("click", (e) => {
      const item = e.target.closest(".autocomplete__item");
      if (item) choose(Number(item.dataset.idx));
    });

    /* Keep focus on the input while a suggestion is being clicked, so the blur
       handler below can close the list unconditionally — without this, tabbing
       out of the field leaves the dropdown hanging over the fields under it. */
    list.addEventListener("mousedown", (e) => e.preventDefault());
    input.addEventListener("blur", closeList);

    input.addEventListener("keydown", (e) => {
      const open = list.classList.contains("open");
      if (e.key === "ArrowDown" && open) {
        e.preventDefault();
        highlight(activeIndex + 1);
      } else if (e.key === "ArrowUp" && open) {
        e.preventDefault();
        highlight(activeIndex - 1);
      } else if (e.key === "Enter") {
        if (open && activeIndex >= 0) {
          e.preventDefault();
          choose(activeIndex);
        }
      } else if (e.key === "Escape") {
        closeList();
      }
    });

    document.addEventListener("click", (e) => {
      if (!list.contains(e.target) && e.target !== input) closeList();
    });

    return { close: closeList };
  }

  // ================================================================
  // Calculator — Places autocomplete, AI estimate, projection
  // ================================================================
  function createCalculator(p, opts) {
    // p = id prefix, e.g. "fc"
    const els = {
      scenarioGroup: document.querySelector(`[data-scenario-group="${p}"]`),
      dwellingGroup: document.querySelector(`[data-dwelling-group="${p}"]`),
      addr: $(`#${p}-addr`),
      addrList: $(`#${p}-addr-list`),
      addrHint: $(`#${p}-addr-hint`),
      beds: $(`#${p}-beds`),
      rentWrap: $(`#${p}-rent-wrap`),
      rent: $(`#${p}-rent`),
      scanBtn: $(`#${p}-scan-btn`),
      scanBtnLabel: $(`#${p}-scan-btn-label`),
      rescanBtn: $(`#${p}-rescan-btn`),
      retryBtn: $(`#${p}-retry-btn`),
      aiLoading: $(`#${p}-ai-loading`),
      aiStep: $(`#${p}-ai-step`),
      aiBar: $(`#${p}-ai-bar`),
      aiResult: $(`#${p}-ai-result`),
      aiLabel: $(`#${p}-ai-label`),
      aiValue: $(`#${p}-ai-value`),
      aiConfidence: $(`#${p}-ai-confidence`),
      aiDelta: $(`#${p}-ai-delta`),
      aiRationale: $(`#${p}-ai-rationale`),
      aiSources: $(`#${p}-ai-sources`),
      aiFreshness: $(`#${p}-ai-freshness`),
      aiError: $(`#${p}-ai-error`),
      aiErrorMsg: $(`#${p}-ai-error-msg`),
    };
    // Bail unless the whole control set is present, rather than failing partway
    // through wiring up listeners on markup that doesn't have them.
    if (!els.addr || !els.beds || !els.scanBtn || !els.scenarioGroup) return null;

    const STEPS = {
      rented: [
        "Pulling comparable listings nearby…",
        "Cross-referencing booking platforms…",
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

    // A real web-grounded call runs ~5-20s, so the copy moves slowly rather than
    // racing to the end of the list and sitting there.
    const STEP_MS = 3500;
    // Requests that beat this are cache hits — show the answer, skip the theatre.
    const LOADING_REVEAL_MS = 400;

    let scenario = "rented"; // "rented" | "new"
    let dwellingType = "house";
    let selected = null; // resolved Google place
    let estimate = null; // validated API response
    let scanning = false;

    let estimateController = null;
    let stepTimer = null;
    let progressTimer = null;
    let revealTimer = null;

    const bedrooms = () => {
      const n = parseInt(els.beds.value, 10);
      return Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 3;
    };

    // ---- scenario tabs ----
    function setScenario(s) {
      scenario = s;
      els.scenarioGroup.querySelectorAll("button").forEach((b) =>
        b.classList.toggle("on", b.dataset.scenario === s)
      );
      if (els.rentWrap) els.rentWrap.hidden = s === "new";
      els.scanBtnLabel.textContent =
        s === "rented" ? "Get AI market rent" : "Get potential rent estimate";

      // The estimate itself doesn't depend on the scenario, so a completed one
      // survives the switch — only the presentation changes.
      if (estimate) {
        renderEstimate(estimate);
        recalc();
      } else {
        resetScan();
        if (opts.onResultsClear) opts.onResultsClear();
      }
      updateScanButton();
    }

    els.scenarioGroup.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-scenario]");
      if (b) setScenario(b.dataset.scenario);
    });

    // ---- dwelling type ----
    if (els.dwellingGroup) {
      els.dwellingGroup.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-dwelling]");
        if (!b || b.dataset.dwelling === dwellingType) return;
        dwellingType = b.dataset.dwelling;
        els.dwellingGroup.querySelectorAll("button").forEach((x) =>
          x.classList.toggle("on", x.dataset.dwelling === dwellingType)
        );
        invalidate(); // changes the cache key — the shown figure no longer applies
      });
    }

    els.beds.addEventListener("input", invalidate);
    if (els.rent) els.rent.addEventListener("input", invalidate);

    /* Any input change makes a displayed estimate stale, so drop it rather than
       letting the number disagree with the visible form. */
    function invalidate() {
      resetScan();
      if (opts.onResultsClear) opts.onResultsClear();
      updateScanButton();
    }

    function resetScan() {
      clearTimeout(stepTimer);
      clearTimeout(revealTimer);
      clearInterval(progressTimer);
      if (estimateController) estimateController.abort();
      estimateController = null;
      scanning = false;
      estimate = null;
      els.scanBtn.hidden = false;
      els.aiLoading.hidden = true;
      els.aiResult.hidden = true;
      if (els.aiError) els.aiError.hidden = true;
      els.aiBar.style.transition = "none";
      els.aiBar.style.width = "0%";
    }

    function updateScanButton() {
      const ready =
        !!selected && (scenario === "new" || parseInt(els.rent.value, 10) > 0);
      els.scanBtn.disabled = !ready || scanning;
    }

    function setHint(text, isError) {
      if (!els.addrHint) return;
      els.addrHint.textContent = text || "";
      els.addrHint.hidden = !text;
      els.addrHint.classList.toggle("calc-card__hint--error", !!isError);
    }

    // ================= address autocomplete =================

    createAddressAutocomplete({
      input: els.addr,
      list: els.addrList,
      idPrefix: p,
      // Editing the field makes any prior estimate stale, so tear it down.
      onTyping: () => {
        selected = null;
        invalidate();
      },
      onResolve: (place) => {
        selected = place;
        updateScanButton();
      },
      onHint: setHint,
    });

    // ================= estimate =================

    els.scanBtn.addEventListener("click", () => {
      if (!els.scanBtn.disabled) runEstimate({ forceRefresh: false });
    });
    if (els.rescanBtn) {
      els.rescanBtn.addEventListener("click", () => {
        // An explicit re-scan is the one place a user can bypass the cache.
        if (!scanning) runEstimate({ forceRefresh: true });
      });
    }
    if (els.retryBtn) {
      els.retryBtn.addEventListener("click", () => {
        if (!scanning) runEstimate({ forceRefresh: false });
      });
    }

    /* Progress reflects a real request of unknown length: the bar eases toward
       90% and only completes when the response lands. */
    function startLoadingUi() {
      const steps = STEPS[scenario];
      let i = 0;
      els.scanBtn.hidden = true;
      els.aiResult.hidden = true;
      if (els.aiError) els.aiError.hidden = true;
      els.aiLoading.hidden = false;
      els.aiStep.textContent = steps[0];

      let width = 0;
      els.aiBar.style.transition = "width 220ms linear";
      progressTimer = setInterval(() => {
        width += (90 - width) * 0.08;
        els.aiBar.style.width = width.toFixed(1) + "%";
      }, 220);

      const advance = () => {
        i = Math.min(i + 1, steps.length - 1);
        els.aiStep.textContent = steps[i];
        if (i < steps.length - 1) stepTimer = setTimeout(advance, STEP_MS);
      };
      stepTimer = setTimeout(advance, STEP_MS);
    }

    function stopLoadingUi() {
      clearTimeout(stepTimer);
      clearTimeout(revealTimer);
      clearInterval(progressTimer);
      els.aiBar.style.width = "100%";
      els.aiLoading.hidden = true;
    }

    function showError(message) {
      stopLoadingUi();
      if (els.aiError) {
        els.aiErrorMsg.textContent = message;
        els.aiError.hidden = false;
      }
      // A failed re-scan doesn't invalidate the estimate already on screen — the
      // totals below are still derived from it, so keep the two consistent.
      const keepPrevious = !!estimate;
      els.aiResult.hidden = !keepPrevious;
      els.scanBtn.hidden = keepPrevious;
    }

    async function runEstimate({ forceRefresh }) {
      if (!selected) return;
      if (scenario === "rented" && !(parseInt(els.rent.value, 10) > 0)) return;

      clearTimeout(stepTimer);
      clearTimeout(revealTimer);
      clearInterval(progressTimer);
      if (estimateController) estimateController.abort();
      const myController = new AbortController();
      estimateController = myController;

      scanning = true;
      els.scanBtn.disabled = true;
      if (els.aiError) els.aiError.hidden = true;

      // Hold the loading UI back briefly — a cache hit returns before this fires,
      // and playing a multi-second scan over a 100ms response would be theatre.
      revealTimer = setTimeout(startLoadingUi, LOADING_REVEAL_MS);

      try {
        const res = await fetch("/api/estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: myController.signal,
          body: JSON.stringify({
            placeId: selected.placeId,
            formattedAddress: selected.formattedAddress,
            locality: selected.locality,
            city: selected.city,
            region: selected.region,
            bedrooms: bedrooms(),
            dwellingType,
            scenario,
            currentWeeklyRent: parseInt(els.rent?.value, 10) || null,
            forceRefresh,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          showError(
            data.error === "not_configured"
              ? "The estimate service isn't configured yet."
              : data.message || "We couldn't analyse that address just now."
          );
          return;
        }

        stopLoadingUi();
        estimate = data;
        renderEstimate(data);
        recalc();
      } catch (err) {
        if (err.name === "AbortError") return; // superseded or user edited an input
        showError("We couldn't reach the estimate service. Please try again.");
      } finally {
        // Only the newest request may clear the busy flag. A superseded one
        // reaching here would otherwise re-enable the button mid-flight and let
        // a duplicate (billed) call through.
        if (estimateController === myController) {
          estimateController = null;
          scanning = false;
          updateScanButton();
        }
      }
    }

    function relativeAge(iso) {
      if (!iso) return "";
      const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
      if (!Number.isFinite(days)) return "";
      if (days <= 0) return "Analysed today";
      if (days === 1) return "Analysed yesterday";
      return `Analysed ${days} days ago`;
    }

    function renderEstimate(data) {
      els.aiLabel.textContent =
        scenario === "rented"
          ? "Current market rent for this address"
          : "Potential long-term rent for this address";
      els.aiValue.textContent =
        "$" + data.weeklyMarketRent.toLocaleString("en-NZ") + "/wk";

      const comparables = data.comparablesFound
        ? ` · ${data.comparablesFound} comparable${data.comparablesFound === 1 ? "" : "s"}`
        : "";
      els.aiConfidence.textContent = `${data.confidence}% confidence${comparables}`;

      if (els.aiRationale) {
        els.aiRationale.textContent = data.rationale || "";
        els.aiRationale.hidden = !data.rationale;
      }

      // Real hostnames the model consulted, not the old decorative logo row.
      if (els.aiSources) {
        els.aiSources.textContent = "";
        const list = Array.isArray(data.sources) ? data.sources : [];
        list.forEach((host) => {
          const span = document.createElement("span");
          span.textContent = host;
          els.aiSources.append(span);
        });
        els.aiSources.hidden = !list.length;
      }

      if (els.aiFreshness) {
        const parts = [];
        if (data.source === "locality") {
          parts.push("Suburb-level estimate — no live analysis for this address");
        } else if (data.cached) {
          parts.push(relativeAge(data.cachedAt));
        }
        // The re-scan button is budgeted, because every press bills. Say so
        // rather than letting an unchanged number read as a broken button.
        if (data.refreshDenied) {
          parts.push("Re-analysis limit reached — showing the saved analysis");
        }
        els.aiFreshness.textContent = parts.join(" · ");
        els.aiFreshness.hidden = !parts.length;
      }

      // Under/over market only means something against a rent the user gave us.
      if (scenario === "rented") {
        const typed = parseInt(els.rent.value, 10);
        const deltaPct = Math.round(
          ((data.weeklyMarketRent - typed) / typed) * 100
        );
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

      els.scanBtn.hidden = true;
      els.aiResult.hidden = false;
    }

    /* The API already accounts for bedrooms and dwelling type, so this applies
       only the commercial factors the model isn't asked about. */
    function recalc() {
      if (!estimate) return;
      const occ = Math.min(CALC.MAX_OCCUPANCY, estimate.occupancy);
      const str = estimate.nightlyRate * 365 * occ * CALC.STR_NET_FACTOR;
      const ltrAnnual = estimate.weeklyMarketRent * 52;
      opts.onResult({ str, ltrAnnual, occ, estimate, scenario });
    }

    return {
      setScenario,
      recalc,
      getState: () => ({
        scenario,
        selected,
        estimate,
        bedrooms: bedrooms(),
        dwellingType,
        currentWeeklyRent: parseInt(els.rent?.value, 10) || null,
      }),
    };
  }

  // ---------- Calculator (hero card) ----------
  let lastProjection = null;

  const fc = createCalculator("fc", {
    onResultsClear() {
      lastProjection = null;
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

      let s5 = 0, l5 = 0;
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const sY = str * Math.pow(CALC.STR_GROWTH, i);
        const lY = ltrAnnual * Math.pow(CALC.LTR_GROWTH, i);
        s5 += sY; l5 += lY;
        rows.push([sY, lY, i]);
      }
      $("#out-5str").textContent = fmt(s5);
      $("#out-5ltr").textContent = fmt(l5);
      $("#out-5diff").textContent = (s5 - l5 >= 0 ? "+" : "") + fmt(s5 - l5);

      lastProjection = {
        strAnnual: str,
        ltrAnnual,
        fiveYearStr: s5,
        fiveYearLtr: l5,
        fiveYearDiff: s5 - l5,
      };

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
    const submitBtn = $("#lead-submit");
    const errorEl = $("#lead-error");
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    const openModal = () => {
      modal.hidden = false;
      modalForm.hidden = false;
      modalThanks.hidden = true;
      if (errorEl) errorEl.hidden = true;
      $("#lead-name").focus();
    };
    const closeModal = () => { modal.hidden = true; };

    const showFormError = (msg) => {
      if (!errorEl) return;
      errorEl.textContent = msg;
      errorEl.hidden = false;
    };

    $("#proj-unlock-btn").addEventListener("click", openModal);
    $("#lead-modal-close").addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });

    submitBtn.addEventListener("click", async () => {
      const name = $("#lead-name").value.trim();
      const email = $("#lead-email").value.trim();
      const phone = $("#lead-phone").value.trim();

      if (name.length < 2) return showFormError("Please enter your name.");
      if (!EMAIL_RE.test(email)) return showFormError("Please enter a valid email address.");

      if (errorEl) errorEl.hidden = true;
      submitBtn.disabled = true;
      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = "Sending…";

      const state = fc ? fc.getState() : {};
      try {
        const res = await fetch("/api/lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            phone,
            placeId: state.selected?.placeId || null,
            formattedAddress: state.selected?.formattedAddress || null,
            bedrooms: state.bedrooms ?? null,
            dwellingType: state.dwellingType || null,
            scenario: state.scenario || null,
            currentWeeklyRent: state.currentWeeklyRent,
            estimate: state.estimate || null,
            projection: lastProjection,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Something went wrong.");

        // Only unlock once the lead is actually recorded.
        modalForm.hidden = true;
        modalThanks.hidden = false;
        projWrap.classList.remove("locked");
      } catch (err) {
        showFormError(err.message || "We couldn't send your details. Please try again.");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    });

    $("#lead-modal-done").addEventListener("click", closeModal);
  }

  // ---------- Assessment CTA form (books an on-site visit) ----------
  const ctaForm = $("#cta-form");

  if (ctaForm) {
    const ctaError = $("#cta-error");
    const ctaSubmit = $("#cta-submit");
    const ctaFields = $(".cta__fields", ctaForm);
    const ctaDone = $(".cta__done", ctaForm);
    const ctaAddr = $("#cta-addr");
    const ctaAddrHint = $("#cta-addr-hint");
    const CTA_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    const showCtaError = (msg) => {
      ctaError.textContent = msg;
      ctaError.hidden = false;
    };

    // The Google place behind the typed address, once confirmed. Null while the
    // visitor is still typing or if the details lookup failed.
    let ctaPlace = null;

    createAddressAutocomplete({
      input: ctaAddr,
      list: $("#cta-addr-list"),
      idPrefix: "cta",
      onTyping: () => {
        ctaPlace = null;
      },
      onResolve: (place) => {
        ctaPlace = place;
      },
      onHint: (text, isError) => {
        ctaAddrHint.textContent = text || "";
        ctaAddrHint.hidden = !text;
        ctaAddrHint.classList.toggle("field-hint--error", !!isError);
      },
    });

    // A validation message describes the form as it was at submit time, so drop
    // it the moment the visitor changes anything rather than leaving it to
    // contradict the corrected field.
    ctaForm.addEventListener("input", () => {
      ctaError.hidden = true;
    });
    ctaForm.addEventListener("change", () => {
      ctaError.hidden = true;
    });

    ctaForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const address = ctaAddr.value.trim();
      const name = $("#cta-name").value.trim();
      const phone = $("#cta-phone").value.trim();
      const email = $("#cta-email").value.trim();
      const preferredTime = $("#cta-time").value;

      if (address.length < 4) return showCtaError("Please enter the property address.");
      // A confirmed place gives sales a map pin and matches the lead to any
      // cached estimate for the same property. Typed-only text does neither.
      if (!ctaPlace) {
        return showCtaError("Please pick your address from the suggestions.");
      }
      if (name.length < 2) return showCtaError("Please enter your name.");
      if (phone.replace(/\D/g, "").length < 7) return showCtaError("Please enter a valid mobile number.");
      if (!CTA_EMAIL_RE.test(email)) return showCtaError("Please enter a valid email address.");

      ctaError.hidden = true;
      ctaSubmit.disabled = true;
      const originalLabel = ctaSubmit.textContent;
      ctaSubmit.textContent = "Sending…";

      try {
        const res = await fetch("/api/lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            phone,
            placeId: ctaPlace.placeId || null,
            formattedAddress: (ctaPlace.formattedAddress || address).slice(0, 300),
            preferredTime,
            source: "assessment",
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Something went wrong.");

        // Only claim the booking once the lead is actually recorded.
        ctaFields.hidden = true;
        ctaDone.hidden = false;
      } catch (err) {
        showCtaError(err.message || "We couldn't send your details. Please try again.");
      } finally {
        ctaSubmit.disabled = false;
        ctaSubmit.textContent = originalLabel;
      }
    });
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
})();
