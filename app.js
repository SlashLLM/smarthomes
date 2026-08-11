/* SmartHomes — calculator + general interactions */

(function () {
  // ---------- Helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const fmt = (n) => "$" + Math.round(n).toLocaleString("en-NZ");
  const pct = (n) => (n >= 0 ? "+" : "") + Math.round(n) + "%";

  // ---------- Tier lookup for hero ----------
  const heroTier = {
    "Mount Maunganui, Tauranga": { adr: 358, occ: 0.83 },
    "Queenstown CBD":            { adr: 412, occ: 0.81 },
    "Ponsonby, Auckland":        { adr: 305, occ: 0.78 },
    "Wānaka":                    { adr: 385, occ: 0.79 },
    "Oriental Bay, Wellington":  { adr: 295, occ: 0.74 },
    "Hahei, Coromandel":         { adr: 340, occ: 0.71 },
  };

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

  // ---------- HERO calc ----------
  const heroSub = $("#hero-suburb");
  const heroBeds = $("#hero-beds");
  const heroRent = $("#hero-rent");

  function recalcHero() {
    const t = heroTier[heroSub.value] || { adr: 320, occ: 0.78 };
    const beds = Math.max(1, parseInt(heroBeds.value, 10) || 1);
    const rent = Math.max(0, parseInt(heroRent.value, 10) || 0);
    const adr = t.adr * (0.65 + beds * 0.18);
    const str = adr * 365 * t.occ * 0.82; // net-ish
    const ltr = rent * 52 * 1.0;
    const diff = str - ltr;
    const pctVal = ltr ? (diff / ltr) * 100 : 0;
    $("#hero-str").textContent = fmt(str);
    $("#hero-ltr").textContent = fmt(ltr);
    $("#hero-delta").textContent = (diff >= 0 ? "+" : "") + fmt(diff);
    $("#hero-pct").textContent = pct(pctVal);
  }
  [heroSub, heroBeds, heroRent].forEach((el) =>
    el.addEventListener("input", recalcHero)
  );
  $("#hero-suburb").addEventListener("change", recalcHero);
  recalcHero();

  // ---------- FULL calculator ----------
  const tier = $("#tier");
  const ptype = $("#ptype");
  const beds = $("#beds");
  const baths = $("#baths");
  const sleeps = $("#sleeps");
  const rent = $("#rent");
  const features = $("#features");

  // feature toggle
  features.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    b.classList.toggle("on");
    recalcFull();
  });

  function bonus() {
    return $$("#features button.on").reduce(
      (a, b) => a + parseFloat(b.dataset.bonus),
      0
    );
  }

  function recalcFull() {
    const tierMult = parseFloat(tier.value);
    const typeMult = parseFloat(ptype.value);
    const b = Math.max(1, parseInt(beds.value, 10) || 1);
    const sl = Math.max(1, parseInt(sleeps.value, 10) || 1);
    const rt = Math.max(0, parseInt(rent.value, 10) || 0);

    // ADR: base $180 + per-bed $70 + sleeps adj
    const baseAdr = (180 + b * 70 + sl * 12) * tierMult * typeMult * (1 + bonus());
    const occ = 0.74 + Math.min(0.14, b * 0.018) + (bonus() > 0 ? 0.03 : 0);
    const str = baseAdr * 365 * occ * 0.82; // host-net after fee+costs
    const ltr = rt * 52;
    const diff = str - ltr;
    const pctVal = ltr ? (diff / ltr) * 100 : 0;

    $("#out-str").textContent = fmt(str);
    $("#out-ltr").textContent = fmt(ltr);
    $("#out-adr").textContent = "$" + Math.round(baseAdr);
    $("#out-occ").textContent = Math.round(occ * 100) + "%";

    // badge
    const badge = document.querySelector(".badge--good span");
    if (badge) badge.textContent = pct(pctVal);

    // 5 year projection: STR grows 6%/yr, LTR 2.5%/yr
    let s5 = 0, l5 = 0;
    const rows = [];
    for (let i = 0; i < 5; i++) {
      const sY = str * Math.pow(1.06, i);
      const lY = ltr * Math.pow(1.025, i);
      s5 += sY; l5 += lY;
      rows.push([sY, lY, i]);
    }
    $("#out-5str").textContent = fmt(s5);
    $("#out-5ltr").textContent = fmt(l5);
    $("#out-5diff").textContent = (s5 - l5 >= 0 ? "+" : "") + fmt(s5 - l5);

    // chart
    const max = Math.max(...rows.flatMap((r) => [r[0], r[1]]));
    const chart = $("#chart");
    chart.innerHTML = rows
      .map(([s, l, i]) => {
        const sh = (s / max) * 100;
        const lh = (l / max) * 100;
        return `
          <div class="col">
            <div class="pair">
              <div class="bar bar--ltr" style="height:${lh}%"></div>
              <div class="bar bar--str" style="height:${sh}%"></div>
            </div>
            <div class="label">Y${i + 1}</div>
          </div>`;
      })
      .join("");
  }

  [tier, ptype, beds, baths, sleeps, rent].forEach((el) => {
    el.addEventListener("input", recalcFull);
    el.addEventListener("change", recalcFull);
  });
  // preselect 2 features for nicer demo numbers
  $$("#features button")[0].classList.add("on");
  $$("#features button")[2].classList.add("on");
  recalcFull();

  // ---------- Smooth-scroll active link ----------
  // (browser already smooth-scrolls; nothing else needed)

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
