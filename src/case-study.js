/* Results section: photo carousels and auto-computed uplift figures. */

const nzd = (n) => "$" + Math.round(n).toLocaleString("en-NZ");

// <dl data-before="33560" data-after="48000"> with [data-fmt="before|after|uplift"] children.
// Before of 0 (e.g. a vacant bach) shows the dollar change instead of a percentage.
export function initUplift(root = document) {
  root.querySelectorAll("dl[data-before][data-after]").forEach((dl) => {
    const before = Number(dl.dataset.before);
    const after = Number(dl.dataset.after);
    if (!Number.isFinite(before) || !Number.isFinite(after)) return;
    const set = (k, v) => dl.querySelectorAll(`[data-fmt="${k}"]`).forEach((el) => (el.textContent = v));
    if (before > 0) set("before", nzd(before));
    set("after", nzd(after));
    const diff = after - before;
    const sign = diff >= 0 ? "+" : "−";
    set("uplift", before > 0 ? `${sign}${Math.round((Math.abs(diff) / before) * 100)}%` : `${sign}${nzd(Math.abs(diff))}`);
  });
}

export function initCarousels(root = document) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.querySelectorAll("[data-carousel]").forEach((c) => {
    const track = c.querySelector("[data-carousel-track]");
    if (!track) return;
    const slides = Array.from(track.children);
    const dots = Array.from(c.querySelectorAll("[data-carousel-dot]"));
    const current = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    const go = (i) => {
      const n = (i + slides.length) % slides.length;
      track.scrollTo({ left: slides[n].offsetLeft, behavior: reduce ? "auto" : "smooth" });
    };
    const paint = () => {
      const i = current();
      dots.forEach((d, k) => {
        d.classList.toggle("bg-brand-white", k === i);
        d.classList.toggle("bg-brand-white/50", k !== i);
        if (k === i) d.setAttribute("aria-current", "true");
        else d.removeAttribute("aria-current");
      });
    };
    c.querySelector("[data-carousel-prev]")?.addEventListener("click", () => go(current() - 1));
    c.querySelector("[data-carousel-next]")?.addEventListener("click", () => go(current() + 1));
    dots.forEach((d, k) => d.addEventListener("click", () => go(k)));
    track.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); go(current() - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); go(current() + 1); }
    });
    let raf = 0;
    track.addEventListener("scroll", () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(paint);
    }, { passive: true });
  });
}

initUplift();
initCarousels();
