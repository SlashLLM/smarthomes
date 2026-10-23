/* Header behaviour shared by every public page: mobile menu + solid-on-scroll. */

export function initNav() {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ---------- Mobile navigation ----------
  const navToggle = $("#nav-toggle");
  const mobileNav = $("#mobileNav");

  if (navToggle && mobileNav) {
    const icon = $(".material-symbols-outlined", navToggle);
    const setOpen = (open) => {
      mobileNav.hidden = !open;
      mobileNav.classList.toggle("flex", open);
      navToggle.setAttribute("aria-expanded", String(open));
      navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      icon.textContent = open ? "close" : "menu";
    };
    navToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(mobileNav.hidden);
    });
    $$("a", mobileNav).forEach((a) => a.addEventListener("click", () => setOpen(false)));
    document.addEventListener("click", (e) => {
      if (!mobileNav.hidden && !e.target.closest("#nav")) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !mobileNav.hidden) {
        setOpen(false);
        navToggle.focus();
      }
    });
  }

  // ---------- Solid header once the hero scrolls away ----------
  const header = $("#nav");
  if (header) {
    const onScroll = () => {
      const solid = window.scrollY > 40;
      header.classList.toggle("bg-brand-cream/90", solid);
      header.classList.toggle("backdrop-blur-md", solid);
      header.classList.toggle("shadow-sm", solid);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
}
