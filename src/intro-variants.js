/* ============================================================
   SmartHomes NZ — alternative intro films (B, C, D).
   Variant A is the original film in intro.js. The head gate in index.html
   picks one and stamps it on <html data-intro>; preview all at /intro-lab.

   Every variant shares one contract with the page:
   - the film photo sits on the live hero photo's exact rect, with the same
     crop, flip and grade, so the final crossfade reveals an identical picture;
   - the camera lands on the hero's paused ken-burns pose (scale 1.04);
   - the handover fades the stage out while the hero copy staggers in.
   ============================================================ */

import { gsap } from "gsap";

const root = document.documentElement;
const variant = root.getAttribute("data-intro");
const HERO_IMG =
  '<img alt="" src="/assets/img/hero-1280.webp" ' +
  'srcset="/assets/img/hero-1280.webp 1280w, /assets/img/hero-2400.webp 2400w" sizes="100vw" />';
const photo = (cls = "") => `<div class="iv-photo ${cls}"><div class="iv-cam">${HERO_IMG}</div></div>`;
const line = (cls, text) => `<span class="iv-line ${cls}"><span>${text}</span></span>`;
const money = (v) => "$" + Math.round(v).toLocaleString("en-NZ");
const isMobile = () => window.innerWidth < 768;

/* Mount Maunganui 3-bed case study — the same figures the Results section shows. */
const CASE = { ltr: 40560, str: 118940, uplift: "+193%" };

function run(v) {
  const heroWrap = document.querySelector(".hero-kenburns");
  // Measure the untransformed parent: .hero-kenburns itself carries the
  // paused scale(1.04), so its rect is already oversized.
  const photoLayer = heroWrap && heroWrap.parentElement;
  const scene = SCENES[v];

  const stage = document.createElement("div");
  stage.id = "intro-v";
  stage.className = `iv iv--${v}` + (isMobile() ? " iv--phone" : "");
  stage.setAttribute("aria-hidden", "true");
  stage.innerHTML = scene.markup + '<button class="iv-skip" type="button">Skip intro ›</button>';
  document.body.appendChild(stage);

  const $ = (s) => stage.querySelector(s);
  const photos = stage.querySelectorAll(".iv-photo");
  const cams = stage.querySelectorAll(".iv-cam");
  const skipBtn = $(".iv-skip");
  const img = $(".iv-cam img");
  let rect = { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };

  /* Desktop: sit exactly on the hero photo so the handover is a true match-cut.
     Phones: the stacked hero is ~3 screens tall and its cover-crop is mostly
     sky, so frame the viewport instead (the house stays in shot) and let the
     final crossfade carry the handover. */
  function placePhoto() {
    if (!photoLayer) return;
    rect = isMobile()
      ? { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight }
      : photoLayer.getBoundingClientRect();
    photos.forEach((p) => {
      p.style.top = rect.top + "px";
      p.style.left = rect.left + "px";
      p.style.width = rect.width + "px";
      p.style.height = rect.height + "px";
    });
  }

  let done = false;
  let tl = null;
  let watchdog = null;

  function teardown(markSeen) {
    if (done) return;
    done = true;
    clearTimeout(watchdog);
    if (markSeen) {
      try { sessionStorage.setItem("sh_intro_seen", "1"); } catch (e) { /* private mode */ }
    }
    root.classList.remove("intro-active");
    stage.remove();
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("wheel", skip);
    window.removeEventListener("touchmove", skip);
    window.removeEventListener("resize", placePhoto);
  }

  // Not marked as seen: a viewer who hit a slow photo still gets it next time.
  function bail() {
    if (tl) tl.kill();
    teardown(false);
  }

  // Fast-forward to the handover rather than hard-cutting, so a skip still
  // lands on the same seamless match-cut.
  function skip() {
    if (done) return;
    if (!tl) return bail();
    if (tl.time() >= tl.labels.handover) return;
    tl.tweenTo("handover", { duration: 0.45, ease: "power2.inOut", onComplete: () => tl.play() });
  }
  function onKey(e) { if (e.key === "Escape") skip(); }

  function handover(at) {
    tl.addLabel("handover", at);
    tl.call(placePhoto, null, at);
    tl.to(cams, { scale: 1.04, duration: 1.1, ease: "power2.inOut" }, at);
    tl.to(skipBtn, { opacity: 0, duration: 0.3 }, at);
    const reveal = at + 0.85;
    tl.to(stage, { opacity: 0, duration: 0.75, ease: "power1.inOut" }, reveal);
    tl.to("#siteLogo, #siteNav", { opacity: 1, duration: 0.6, ease: "power2.out" }, reveal);
    tl.to("[data-intro-reveal]", {
      opacity: 1, y: 0, duration: 0.7, ease: "power3.out", stagger: 0.06, clearProps: "transform",
    }, reveal + 0.1);
    gsap.utils.toArray("[data-intro-fade]").forEach((el) => {
      tl.to(el, { opacity: parseFloat(el.getAttribute("data-intro-fade")) || 1, duration: 0.9 }, reveal);
    });
  }

  function start() {
    if (done) return;
    clearTimeout(watchdog);
    placePhoto();
    gsap.set("[data-intro-reveal]", { y: 24 });
    tl = gsap.timeline({ paused: true, onComplete: () => teardown(true) });
    scene.build({ tl, $, stage, cams, photos, getRect: () => rect, handover });
    if (isMobile()) tl.timeScale(1.12);
    tl.play();
  }

  placePhoto();
  window.addEventListener("resize", placePhoto);
  skipBtn.addEventListener("click", skip);
  window.addEventListener("keydown", onKey);
  window.addEventListener("wheel", skip, { passive: true });
  window.addEventListener("touchmove", skip, { passive: true });

  // Never trap the viewer behind the stage.
  watchdog = setTimeout(bail, 2500);
  const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.all([img.decode ? img.decode().catch(() => {}) : Promise.resolve(), ready]).then(start, start);
}

/* =====================================================================
   B · Aperture — architectural restraint. A hairline opens into a window
   onto the house; two quiet lines make the case; the window becomes the hero.
   ===================================================================== */
function aperture() {}
aperture.markup = `
  ${photo("b-photo")}
  <div class="iv-eyebrow b-eyebrow"><b>SmartHomes</b> &nbsp;·&nbsp; Holiday home management, Aotearoa</div>
  <div class="b-rule"></div>
  <div class="b-chip">
    <div class="cap">Long-term let</div>
    <div class="val iv-num">$0</div>
    <div class="sub">3-bed · Mount Maunganui · per year</div>
    <div class="pill">${CASE.uplift} · same house</div>
  </div>
  <div class="b-copy">
    ${line("l1", "Every home has a second income.")}
    ${line("l2", "Most owners never see it.")}
  </div>`;
aperture.build = ({ tl, $, cams, getRect, handover }) => {
  const box = $(".b-photo");
  const val = $(".b-chip .val");
  const cap = $(".b-chip .cap");

  // The aperture is described in viewport fractions and converted to a
  // clip-path on the (possibly taller than viewport) hero-sized photo.
  const ap = { t: 0.5, r: 0.28, b: 0.5, l: 0.28, rad: 2 };
  const win = isMobile() ? { t: 0.16, r: 0.06, b: 0.38, l: 0.06 } : { t: 0.2, r: 0.2, b: 0.3, l: 0.2 };
  const apply = () => {
    const r = getRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top = ap.t * vh - r.top;
    const left = ap.l * vw - r.left;
    const right = r.width - ((1 - ap.r) * vw - r.left);
    const bottom = r.height - ((1 - ap.b) * vh - r.top);
    box.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px round ${ap.rad}px)`;
  };
  apply();
  const n = { v: 0 };
  const count = () => { val.textContent = money(n.v); };

  gsap.set(cams, { scale: 1.3 });
  gsap.set(".b-copy .iv-line > span", { yPercent: 110 });

  tl.to(".b-eyebrow", { opacity: 1, duration: 0.8, ease: "power2.out" }, 0.15);
  tl.to(".b-rule", { scaleX: 1, duration: 0.8, ease: "expo.out" }, 0.3);

  // the slit opens into a window
  tl.to(".b-rule", { opacity: 0, duration: 0.3 }, 1.0);
  tl.to(ap, { ...win, rad: 22, duration: 1.2, ease: "expo.inOut", onUpdate: apply }, 0.95);
  tl.to(cams, { scale: 1.14, duration: 4.4, ease: "none" }, 0.95);

  tl.to(".b-copy .l1 > span", { yPercent: 0, duration: 1, ease: "expo.out" }, 1.7);
  tl.to(".b-copy .l2 > span", { yPercent: 0, duration: 1, ease: "expo.out" }, 2.1);

  // the proof, in one small card
  tl.fromTo(".b-chip", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 2.3);
  tl.to(n, { v: CASE.ltr, duration: 0.9, ease: "power2.out", onUpdate: count }, 2.45);
  tl.to(cap, { opacity: 0, duration: 0.2 }, 3.4);
  tl.call(() => { cap.textContent = "Managed short-stay"; }, null, 3.6);
  tl.to(cap, { opacity: 1, color: "#A6431E", duration: 0.3 }, 3.6);
  tl.to(val, { color: "#A6431E", duration: 0.4 }, 3.6);
  tl.to(n, { v: CASE.str, duration: 1, ease: "power2.inOut", onUpdate: count }, 3.6);
  tl.fromTo(".b-chip .pill", { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(2)" }, 4.45);

  // clear the stage, then the window becomes the hero
  tl.to(".b-copy .iv-line > span", { yPercent: -110, duration: 0.6, ease: "expo.in", stagger: 0.06 }, 5.2);
  tl.to(".b-chip, .b-eyebrow", { opacity: 0, y: -8, duration: 0.45, ease: "power2.in" }, 5.25);
  tl.to(ap, { t: 0, r: 0, b: 0, l: 0, rad: 0, duration: 1.15, ease: "expo.inOut", onUpdate: apply }, 5.55);
  tl.set(".b-photo", { clipPath: "none" }, 6.75);
  handover(5.75);
};

/* =====================================================================
   C · Ledger — an editorial owner report on espresso. Ruled rows count up
   the proof, the page splits open onto the house, and the wordmark rises.
   ===================================================================== */
function ledger() {}
ledger.markup = `
  ${photo()}
  <div class="c-scrim"></div>
  <div class="c-door l"></div><div class="c-door r"></div>
  <div class="c-tag">Holiday home management, done properly.</div>
  <div class="c-mark-wrap"><span class="c-mark">SmartHomes<em>.</em></span></div>
  <div class="c-ledger"><div class="c-ledger-in">
    <div class="iv-eyebrow c-eyebrow">The 2025 owner ledger</div>
    <div class="c-row">${line("lab", "Paid out to owners")}<div class="val iv-num" data-to="14.2" data-fmt="m">$0.0M</div><i class="rule"></i></div>
    <div class="c-row">${line("lab", "Average annual occupancy")}<div class="val iv-num" data-to="83" data-fmt="pct">0%</div><i class="rule"></i></div>
    <div class="c-row">${line("lab", "Average uplift on long-term rent")}<div class="val accent iv-num" data-to="167" data-fmt="up">+0%</div><i class="rule"></i></div>
  </div></div>`;
ledger.build = ({ tl, $, stage, cams, handover }) => {
  const fmt = {
    m: (v) => "$" + v.toFixed(1) + "M",
    pct: (v) => Math.round(v) + "%",
    up: (v) => "+" + Math.round(v) + "%",
  };

  gsap.set(cams, { scale: 1.22 });
  gsap.set(".c-row .iv-line > span", { yPercent: 110 });
  gsap.set(".c-row .val", { opacity: 0, y: 18 });
  gsap.set(".c-mark", { yPercent: 105 });

  tl.to(".c-eyebrow", { opacity: 1, duration: 0.7, ease: "power2.out" }, 0.2);

  stage.querySelectorAll(".c-row").forEach((row, i) => {
    const at = 0.45 + i * 0.55;
    const val = row.querySelector(".val");
    const o = { v: 0 };
    const to = parseFloat(val.dataset.to);
    const f = fmt[val.dataset.fmt];
    tl.to(row.querySelector(".rule"), { scaleX: 1, duration: 0.9, ease: "expo.out" }, at);
    tl.to(row.querySelector(".iv-line > span"), { yPercent: 0, duration: 0.8, ease: "expo.out" }, at + 0.1);
    tl.to(val, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, at + 0.15);
    tl.to(o, { v: to, duration: 1.2, ease: "power2.out", onUpdate: () => { val.textContent = f(o.v); } }, at + 0.15);
  });

  // the ledger lifts away and the page opens onto the house
  tl.to(".c-ledger-in > *", { opacity: 0, y: -24, duration: 0.5, ease: "power2.in", stagger: 0.05 }, 3.35);
  tl.to(".c-door.l", { xPercent: -101, duration: 1.3, ease: "expo.inOut" }, 3.8);
  tl.to(".c-door.r", { xPercent: 101, duration: 1.3, ease: "expo.inOut" }, 3.8);
  tl.to(cams, { scale: 1.1, duration: 2.2, ease: "power2.out" }, 3.8);

  tl.to(".c-scrim", { opacity: 1, duration: 0.8 }, 4.3);
  tl.to(".c-mark", { yPercent: 0, duration: 1.2, ease: "expo.out" }, 4.4);
  tl.fromTo(".c-tag", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" }, 4.95);

  tl.to(".c-tag", { opacity: 0, duration: 0.35 }, 6.1);
  tl.to(".c-mark", { yPercent: 105, duration: 0.7, ease: "expo.in" }, 6.1);
  tl.to(".c-scrim", { opacity: 0, duration: 0.6 }, 6.4);
  handover(6.6);
};

/* =====================================================================
   D · Split — the whole proposition in one frame. The same house, run two
   ways; the divider sweeps the long-term let away.
   ===================================================================== */
function split() {}
split.markup = `
  ${photo("d-colour")}
  ${photo("d-grey")}
  <div class="d-scrim"></div>
  <div class="d-divider"><i></i></div>
  <div class="d-caption">
    <div class="h">${line("", "Same house. Two ways to run it.")}</div>
    <div class="s iv-eyebrow">3-bed · Mount Maunganui · year one</div>
  </div>
  <div class="d-side l"><div class="cap">Long-term let</div><div class="val iv-num"><span>$0</span><small>/yr</small></div></div>
  <div class="d-side r"><div class="cap">Managed short-stay</div><div class="val iv-num"><span>$0</span><small>/yr</small></div><div class="pill">${CASE.uplift} · same keys, same house</div></div>`;
split.build = ({ tl, $, stage, cams, handover }) => {
  const grey = $(".d-grey");
  const divider = $(".d-divider");
  const lVal = $(".d-side.l .val span");
  const rVal = $(".d-side.r .val span");
  const cut = { x: 50 }; // divider position, % of viewport width
  const apply = () => {
    grey.style.clipPath = `inset(0 ${100 - cut.x}% 0 0)`;
    divider.style.left = cut.x + "%";
  };
  apply();
  const l = { v: 0 };
  const r = { v: 0 };

  gsap.set(cams, { scale: 1.16 });
  gsap.set(stage.querySelectorAll(".iv-photo"), { opacity: 0 });
  gsap.set(".d-caption .iv-line > span", { yPercent: 110 });

  tl.to(stage.querySelectorAll(".iv-photo"), { opacity: 1, duration: 1, ease: "power2.out" }, 0);
  tl.to(cams, { scale: 1.08, duration: 5.6, ease: "none" }, 0);
  tl.to(".d-scrim", { opacity: 1, duration: 0.8 }, 0.2);
  tl.to(".d-caption .iv-line > span", { yPercent: 0, duration: 0.9, ease: "expo.out" }, 0.45);
  tl.to(".d-caption .s", { opacity: 1, duration: 0.6 }, 0.85);
  tl.to(divider, { scaleY: 1, duration: 0.9, ease: "expo.out" }, 0.8);

  tl.fromTo(".d-side", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out", stagger: 0.12 }, 1.1);
  tl.to(l, { v: CASE.ltr, duration: 2.1, ease: "power1.out", onUpdate: () => { lVal.textContent = money(l.v); } }, 1.3);
  tl.to(r, { v: CASE.str, duration: 2.1, ease: "power1.out", onUpdate: () => { rVal.textContent = money(r.v); } }, 1.3);

  // the sweep: the long-term let is wiped away
  tl.to(".d-side.l", { opacity: 0, x: -16, duration: 0.45, ease: "power2.in" }, 3.75);
  tl.to(cut, { x: 0, duration: 1.2, ease: "expo.inOut", onUpdate: apply }, 3.85);
  tl.to(divider, { opacity: 0, duration: 0.3 }, 4.85);
  tl.fromTo(".d-side.r .pill", { opacity: 0, y: 8, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: "back.out(2)" }, 4.55);

  tl.to(".d-caption, .d-side.r", { opacity: 0, y: -10, duration: 0.45, ease: "power2.in" }, 5.6);
  tl.to(".d-scrim", { opacity: 0, duration: 0.6 }, 5.7);
  handover(5.9);
};

/* ---------- boot (last, so every scene above is defined) ---------- */
const SCENES = { b: aperture, c: ledger, d: split };

if (root.classList.contains("intro-active") && SCENES[variant]) {
  window.__shIntro = true;
  run(variant);
}
