/* ============================================================
   SmartHomes NZ — Cinematic Intro Film
   One paused GSAP master timeline, ~11.3s, ending in a match-cut
   onto the live hero. See the head of index.html for the gate that
   decides whether any of this runs at all.
   ============================================================ */

import { gsap } from "gsap";

(function () {
  'use strict';

  var root = document.documentElement;
  var film = document.getElementById('intro-film');

  // Tell the head gate's failsafe that the film has claimed the stage.
  window.__shIntro = true;

  // The head gate already decided. If it didn't arm us, drop the markup and
  // leave. (CSS also keeps the stage display:none unless .intro-active is
  // set, and the gate releases the page itself if this file never runs.)
  // Variants b/c/d are played by intro-variants.js; this file is variant 'a'.
  var variant = root.getAttribute('data-intro') || 'a';
  if (!root.classList.contains('intro-active') || variant !== 'a') {
    if (film && film.parentNode) film.parentNode.removeChild(film);
    return;
  }

  var heroWrap  = document.querySelector('.hero-kenburns');
  // Measure the untransformed parent, NOT .hero-kenburns itself: that
  // element carries the paused ken-burns scale(1.04), so its client rect
  // is already 4% oversized and the film would be scaled twice.
  var photoLayer = heroWrap && heroWrap.parentElement;
  var siteLogo  = document.getElementById('siteLogo');
  var filmPhoto = document.getElementById('filmPhoto');
  var filmCam   = document.getElementById('filmCam');
  var filmImg   = document.getElementById('filmImg');
  var filmLogo  = document.getElementById('filmLogo');
  var curtain   = document.getElementById('filmCurtain');
  var skipBtn   = document.getElementById('filmSkip');
  var counterEl = document.querySelector('#filmCounter .val');
  var labelEl   = document.getElementById('filmLabelText');
  var dustEl    = document.getElementById('filmDust');

  var done = false;
  var tl = null;
  var watchdog = null;

  /* ---------- teardown: hand the screen to the real site ---------- */

  function teardown(markSeen) {
    if (done) return;
    done = true;
    clearTimeout(watchdog);
    if (markSeen) {
      try { sessionStorage.setItem('sh_intro_seen', '1'); } catch (e) {}
    }
    // Releasing the class un-pauses the hero ken-burns from its 0%
    // keyframe — exactly the pose the film camera landed on.
    root.classList.remove('intro-active');
    if (film && film.parentNode) film.parentNode.removeChild(film);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('wheel', onSkipGesture);
    window.removeEventListener('touchmove', onSkipGesture);
  }

  function finish() { teardown(true); }

  // Bail out without playing anything (slow photo, missing GSAP). This
  // deliberately does NOT mark the intro as seen, so a viewer who hit a
  // cold cache or a blocked CDN still gets the film on their next load.
  function bail() {
    if (done) return;
    if (tl) { tl.kill(); tl = null; }
    teardown(false);
  }

  /* ---------- skip ---------- */

  // Fast-forwards through the blend rather than hard-cutting, so a skip
  // still lands on the same match-cut the full film does.
  function skip() {
    if (done || !tl) { bail(); return; }
    if (tl.time() >= tl.labels.blend) return;   // already blending, let it land
    placePhoto();
    tl.tweenTo('blend', {
      duration: 0.4,
      ease: 'power2.inOut',
      onComplete: function () { tl.play(); }
    });
  }

  function onKey(e) { if (e.key === 'Escape') skip(); }
  function onSkipGesture() { skip(); }

  /* ---------- geometry: put the film photo on the hero's exact rect ---------- */

  function placePhoto() {
    if (!photoLayer || !filmPhoto) return;
    var r = photoLayer.getBoundingClientRect();
    filmPhoto.style.top    = r.top + 'px';
    filmPhoto.style.left   = r.left + 'px';
    filmPhoto.style.width  = r.width + 'px';
    filmPhoto.style.height = r.height + 'px';
  }

  /* ---------- dust ---------- */

  function seedDust() {
    if (!dustEl) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 20; i++) {
      var m = document.createElement('i');
      m.className = 'mote';
      var size = (1.5 + Math.random() * 2.6).toFixed(1);
      m.style.width = size + 'px';
      m.style.height = size + 'px';
      m.style.left = (Math.random() * 100).toFixed(2) + '%';
      m.style.top = (30 + Math.random() * 70).toFixed(2) + '%';
      m.style.animationDuration = (7 + Math.random() * 9).toFixed(1) + 's';
      m.style.animationDelay = (-Math.random() * 10).toFixed(1) + 's';
      frag.appendChild(m);
    }
    dustEl.appendChild(frag);
  }

  /* ---------- typing label ---------- */

  function typeLabel(text, dur) {
    var o = { n: 0 };
    return gsap.to(o, {
      n: text.length,
      duration: dur,
      ease: 'none',
      onUpdate: function () {
        labelEl.textContent = text.slice(0, Math.round(o.n));
      }
    });
  }

  /* ---------- the film ---------- */

  function build() {
    var money = { v: 0 };
    var grade = { sat: 0.12, bri: 0.52, con: 0.95, wash: 0.78, vig: 1 };

    function applyGrade() {
      filmImg.style.setProperty('--grade-sat', grade.sat);
      filmImg.style.setProperty('--grade-bri', grade.bri);
      filmImg.style.setProperty('--grade-con', grade.con);
      filmPhoto.style.setProperty('--wash', grade.wash);
      filmPhoto.style.setProperty('--vig', grade.vig);
    }
    applyGrade();

    function renderMoney() {
      counterEl.textContent = '$' + Math.round(money.v).toLocaleString('en-NZ');
    }

    var cards  = gsap.utils.toArray('.film-card');
    var fronts = gsap.utils.toArray('.film-card .face.front');
    var backs  = gsap.utils.toArray('.film-card .face.back');
    var tilts  = [-4.5, 3.2, -2.6, 4.4];

    tl = gsap.timeline({ paused: true, onComplete: finish });

    /* — Scene 1 · the house (0.0–1.8) — */

    tl.fromTo('.film-bars i',
      { height: '52vh' },
      { height: function () { return window.innerWidth < 768 ? '7vh' : '11vh'; },
        duration: 1.35, ease: 'power3.out' }, 0);

    tl.fromTo(film, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'none' }, 0);

    // Deliberately frozen at first, then the slowest possible pull-back.
    tl.to(filmCam, { scale: 1.26, duration: 4.6, ease: 'none' }, 0.35);

    tl.add(typeLabel('LONG-TERM TENANCY · YEAR 3', 1.0), 0.6);
    tl.to('.film-label .caret', {
      opacity: 0, duration: 0.45, repeat: 11, yoyo: true, ease: 'steps(1)'
    }, 0.6);
    tl.set('.film-label .caret', { opacity: 0 }, 6.5);

    /* — Scene 2 · the decay (1.8–4.6) — */

    tl.to(dustEl, { opacity: 1, duration: 1.2, ease: 'power1.out' }, 1.7);

    cards.forEach(function (card, i) {
      var at = 1.85 + i * 0.42;
      tl.fromTo(card,
        { opacity: 0, x: -70 - i * 14, y: 26, rotate: tilts[i] - 9, scale: 0.9 },
        { opacity: 1, x: 0, y: 0, rotate: tilts[i], scale: 1,
          duration: 0.72, ease: 'back.out(2.1)' }, at);
      // a small mechanical settle — the frame refusing to sit straight
      tl.to(card, {
        keyframes: [
          { x: 3, rotate: tilts[i] + 1.1, duration: 0.05, ease: 'steps(1)' },
          { x: -2, rotate: tilts[i] - 0.7, duration: 0.05, ease: 'steps(1)' },
          { x: 0, rotate: tilts[i], duration: 0.05, ease: 'steps(1)' }
        ]
      }, at + 0.72);
    });

    tl.to('#filmCounter', { opacity: 1, duration: 0.5, ease: 'power2.out' }, 2.0);
    tl.to(money, { v: 40560, duration: 1.5, ease: 'power2.out', onUpdate: renderMoney }, 2.05);

    // the grade keeps sinking while the evidence piles up
    tl.to(grade, { bri: 0.44, wash: 0.86, duration: 2.6, ease: 'power1.in',
      onUpdate: applyGrade }, 1.9);

    /* — Scene 3 · the turn (4.6–5.8) — */

    tl.addLabel('turn', 4.6);

    tl.fromTo('#filmSweep',
      { left: '-70vw', opacity: 0 },
      { left: '115vw', opacity: 1, duration: 1.05, ease: 'power2.inOut' }, 4.6);
    tl.to('#filmSweep', { opacity: 0, duration: 0.3 }, 5.4);

    // colour floods back — one filter chain, one tween
    tl.to(grade, {
      sat: 1.15, bri: 1, con: 1.05, wash: 0, vig: 0.34,
      duration: 1.15, ease: 'power2.out', onUpdate: applyGrade
    }, 4.78);

    tl.to(dustEl, { opacity: 0, duration: 0.7 }, 4.8);

    cards.forEach(function (card, i) {
      var at = 4.85 + i * 0.09;
      tl.to(card, { rotate: 0, scale: 1.02, duration: 0.85,
        ease: 'elastic.out(1, 0.55)' }, at);
      tl.to(card, { scale: 1, duration: 0.3 }, at + 0.85);
      // grey hardware warms to the brand palette
      tl.to(card.querySelector('.ic'),
        { backgroundColor: '#FFEFD5', color: '#C85A32', duration: 0.5 }, at + 0.1);
      tl.to(card.querySelectorAll('.t'), { color: '#2D241E', duration: 0.5 }, at + 0.1);
      tl.to(fronts[i], { opacity: 0, y: -8, duration: 0.34, ease: 'power2.in' }, at + 0.06);
      tl.fromTo(backs[i], { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.42, ease: 'power2.out' }, at + 0.26);
    });

    tl.add(typeLabel('SHORT-STAY · MANAGED BY SMARTHOMES', 0.7), 5.15);
    tl.to('.film-label .dot', { backgroundColor: '#3DA35D', duration: 0.4 }, 5.15);

    /* — Scene 4 · the upside (5.8–7.6) — */

    tl.to(counterEl, {
      color: '#FFDAB9',
      textShadow: '0 2px 34px rgba(200, 90, 50, 0.6)',
      duration: 0.6
    }, 5.95);
    tl.to('#filmCounter .cap.lt', { opacity: 0, duration: 0.3 }, 5.9);
    tl.to('#filmCounter .cap.str', { opacity: 1, duration: 0.4 }, 6.1);
    tl.to(money, { v: 118940, duration: 1.35, ease: 'power2.inOut',
      onUpdate: renderMoney }, 5.95);

    tl.fromTo('.film-stamp',
      { opacity: 0, scale: 1.7, rotate: -14 },
      { opacity: 1, scale: 1, rotate: -3, duration: 0.5, ease: 'back.out(2.6)' }, 6.95);

    // cards orbit outward and dissolve
    cards.forEach(function (card, i) {
      tl.to(card, {
        opacity: 0,
        x: -60 - i * 26,
        y: (i % 2 ? 34 : -34),
        rotate: tilts[i] * 0.8,
        scale: 0.94,
        duration: 0.62,
        ease: 'power2.in'
      }, 6.45 + i * 0.07);
    });

    /* — Scene 5 · title card (7.6–9.8) — */

    tl.addLabel('title', 7.55);

    tl.to('.film-title-scrim', { opacity: 1, duration: 0.85, ease: 'power2.inOut' }, 7.5);
    tl.to('#filmCounter, .film-stamp, .film-label',
      { opacity: 0, duration: 0.5, ease: 'power2.in' }, 7.5);

    // camera settles onto the hero's frozen ken-burns pose: scale 1.04
    tl.to(filmCam, { scale: 1.04, duration: 2.1, ease: 'power2.inOut' }, 7.5);

    // Final re-measure while the dark title card hides the frame. Web fonts
    // reflow the hero after first paint and change its height by ~12px,
    // which is enough to shift the object-fit:cover crop by ~1% — visible
    // as a jump at the handover if we trusted the load-time measurement.
    tl.call(placePhoto, null, 9.8);

    // The hero's own washes come up while the dark title card hides them,
    // so the film photo is dressed identically to the live hero by 9.0s.
    tl.to('.film-hero-grade', { opacity: 1, duration: 1.4, ease: 'power1.inOut' }, 7.6);

    tl.fromTo(filmLogo,
      { opacity: 0, scale: 0.9, filter: 'blur(14px)' },
      { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 1.15, ease: 'power3.out' }, 7.95);

    tl.fromTo('#filmGlow',
      { opacity: 0, scale: 0.75 },
      { opacity: 1, scale: 1, duration: 1.3, ease: 'power2.out' }, 8.05);
    tl.to('#filmGlow', { opacity: 0.45, duration: 1.1, ease: 'sine.inOut' }, 9.35);

    tl.to('.film-introducing span', {
      opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', stagger: 0.16
    }, 8.65);

    tl.to('.film-tagline', { opacity: 1, duration: 0.7, ease: 'power2.out' }, 9.2);

    /* — Scene 6 · the blend (9.9–11.3) — */

    tl.addLabel('blend', 9.9);

    // Everything the film painted on top comes off FIRST, so that by 10.45
    // the frame is nothing but the graded photo — no scrim, no bars, no
    // vignette. Only then does the photo itself hand over.
    tl.to('.film-introducing, .film-tagline',
      { opacity: 0, y: -12, duration: 0.4, ease: 'power2.in' }, 9.9);
    tl.to(skipBtn, { opacity: 0, duration: 0.3 }, 9.9);
    tl.to('#filmGlow', { opacity: 0, duration: 0.5 }, 9.92);
    tl.to('.film-title-scrim', { opacity: 0, duration: 0.5, ease: 'power2.inOut' }, 9.95);
    tl.to('.film-bars i', { height: '0vh', duration: 0.8, ease: 'power3.inOut' }, 9.95);
    tl.to(grade, { vig: 0, duration: 0.85, ease: 'power2.out', onUpdate: applyGrade }, 9.95);

    // the wordmark flies into the real header slot
    tl.add(function () { morphLogo(0.85); }, 10.05);
    tl.to('#filmLogo .wm-name', { fill: '#2D241E', duration: 0.5 }, 10.35);

    // THE MATCH-CUT, at 10.55 — after the overlays are gone. The film photo
    // crossfades to the live hero photo underneath it. Same file, same rect,
    // same crop, same filter, same paused 1.04 ken-burns pose, same three
    // washes: a crossfade between two identical pictures, which by
    // construction shows nothing. Dropping the stage's cream backdrop on the
    // same frame is what lets the real site through, so the hero copy can
    // stagger in on top instead of behind.
    tl.set(film, { backgroundColor: 'rgba(255, 248, 231, 0)' }, 10.55);
    tl.to('#filmPhoto', { opacity: 0, duration: 0.35, ease: 'none' }, 10.55);

    // cream wave washes up and off, painting the site in behind it
    tl.to(curtain, { yPercent: 0, duration: 1.05, ease: 'power2.inOut' }, 10.55);

    tl.to(filmLogo, { opacity: 0, duration: 0.16 }, 10.9);
    tl.to(siteLogo, { opacity: 1, duration: 0.16 }, 10.92);
    // opacity-only reveals that must land on their own value, not 1
    gsap.utils.toArray('[data-intro-fade]').forEach(function (el) {
      tl.to(el, {
        opacity: parseFloat(el.getAttribute('data-intro-fade')) || 1,
        duration: 0.9, ease: 'power2.out'
      }, 10.85);
    });

    tl.to('#siteNav', { opacity: 1, duration: 0.5, ease: 'power2.out' }, 11.0);
    tl.to('[data-intro-reveal]', {
      opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.06,
      clearProps: 'transform'
    }, 10.9);

    tl.to({}, { duration: 0.05 }, 11.95);

    if (window.innerWidth < 768) tl.timeScale(1.15);

    tl.play();
  }

  /* ---------- manual FLIP for the logo (no plugin needed) ---------- */

  function morphLogo(dur) {
    if (!siteLogo || !filmLogo) return;
    var from = filmLogo.getBoundingClientRect();
    var to = siteLogo.getBoundingClientRect();
    if (!from.width || !to.width) return;
    gsap.to(filmLogo, {
      x: (to.left + to.width / 2) - (from.left + from.width / 2),
      y: (to.top + to.height / 2) - (from.top + from.height / 2),
      scale: to.width / from.width,
      duration: dur,
      ease: 'power3.inOut'
    });
  }

  /* ---------- boot ---------- */

  function start() {
    if (done) return;
    if (typeof gsap === 'undefined') { bail(); return; }
    clearTimeout(watchdog);
    placePhoto();
    gsap.set('[data-intro-reveal]', { y: 24 });
    gsap.set('.film-introducing span', { y: 14 });
    seedDust();
    build();
  }

  placePhoto();
  window.addEventListener('resize', function () { if (!done) placePhoto(); });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { if (!done) placePhoto(); });
  }

  skipBtn.addEventListener('click', skip);
  window.addEventListener('keydown', onKey);
  window.addEventListener('wheel', onSkipGesture, { passive: true });
  window.addEventListener('touchmove', onSkipGesture, { passive: true });

  // Never trap the viewer behind the curtain: if the hero photo
  // or GSAP hasn't arrived in 2.5s, show the site instead.
  watchdog = setTimeout(bail, 2500);

  if (filmImg.decode) {
    filmImg.decode().then(start).catch(start);
  } else if (filmImg.complete) {
    start();
  } else {
    filmImg.addEventListener('load', start);
    filmImg.addEventListener('error', bail);
  }
})();
