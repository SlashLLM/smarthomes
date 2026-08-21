// SmartHomes — Tweaks panel
// Lets the user swap palette, type pairing, and toggle the trust ticker / dashboard density.

const { useEffect } = React;
const { createRoot } = ReactDOM;

const DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": ["#1F3A2A", "#C46438", "#F6F1E6", "#14241B"],
  "fontPair": "Newsreader + Geist",
  "ticker": true,
  "heroBg": "Cream"
}/*EDITMODE-END*/;

const PALETTES = [
  // [primary, accent, paper, ink]
  ["#1F3A2A", "#C46438", "#F6F1E6", "#14241B"], // Forest + Terracotta (default)
  ["#1A2B4A", "#D69556", "#F4F0E8", "#0F1A2E"], // Navy + Amber
  ["#2E2A24", "#A86F4F", "#EFE9DB", "#1A1814"], // Espresso + Clay
  ["#0F3D2E", "#E8B556", "#F4EFE3", "#0A1F18"], // Deep emerald + Honey
  ["#4A1F2E", "#D88B6C", "#F3EAE0", "#2A0F18"], // Bordeaux + Peach
];

const FONT_PAIRS = {
  "Newsreader + Geist": { serif: "Newsreader", sans: "Geist" },
  "Fraunces + Inter Tight": { serif: "Fraunces", sans: "Inter Tight" },
  "DM Serif Display + Manrope": { serif: "DM Serif Display", sans: "Manrope" },
  "Instrument Serif + Geist": { serif: "Instrument Serif", sans: "Geist" },
};

function App() {
  const [t, setTweak] = useTweaks(DEFAULTS);

  // Apply palette
  useEffect(() => {
    const [primary, accent, paper, ink] = t.palette;
    const r = document.documentElement.style;
    r.setProperty("--primary", primary);
    r.setProperty("--primary-2", primary);
    r.setProperty("--accent", accent);
    r.setProperty("--paper", paper);
    r.setProperty("--paper-2", shade(paper, -6));
    r.setProperty("--ink", ink);
    r.setProperty("--ink-soft", shade(ink, 22));
  }, [t.palette]);

  // Apply fonts
  useEffect(() => {
    const f = FONT_PAIRS[t.fontPair];
    if (!f) return;
    // Inject Google Fonts link
    const id = "tw-fonts";
    let link = document.getElementById(id);
    const fams = `family=${encodeURIComponent(f.serif).replace(/%20/g,"+")}:ital,wght@0,300..700;1,400&family=${encodeURIComponent(f.sans).replace(/%20/g,"+")}:wght@300..700`;
    const href = `https://fonts.googleapis.com/css2?${fams}&display=swap`;
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = href;
    const r = document.documentElement.style;
    r.setProperty("--serif", `"${f.serif}", Georgia, serif`);
    r.setProperty("--sans", `"${f.sans}", -apple-system, sans-serif`);
  }, [t.fontPair]);

  // Ticker visibility
  useEffect(() => {
    const tk = document.querySelector(".ticker");
    if (tk) tk.style.display = t.ticker ? "" : "none";
  }, [t.ticker]);

  // Hero bg style
  useEffect(() => {
    const bg = document.querySelector(".hero__bg");
    if (!bg) return;
    if (t.heroBg === "Cream") {
      bg.style.background = `radial-gradient(60% 50% at 80% 10%, rgba(196,100,56,0.10), transparent 60%), radial-gradient(50% 50% at 0% 30%, rgba(31,58,42,0.06), transparent 70%)`;
    } else if (t.heroBg === "Ink") {
      bg.style.background = `linear-gradient(180deg, ${shade(t.palette[3], 4)} 0%, ${t.palette[2]} 75%)`;
      document.querySelector(".hero").style.color = "";
    } else if (t.heroBg === "Topo") {
      bg.style.background = `
        repeating-radial-gradient(circle at 30% 20%, rgba(31,58,42,0.05) 0 1px, transparent 1px 22px),
        radial-gradient(70% 60% at 80% 0%, rgba(196,100,56,0.10), transparent 60%),
        var(--paper)`;
    }
  }, [t.heroBg, t.palette]);

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection title="Palette" subtitle="primary · accent · paper · ink">
        <TweakColor
          label="Theme"
          value={t.palette}
          onChange={(v) => setTweak("palette", v)}
          options={PALETTES}
        />
      </TweakSection>

      <TweakSection title="Typography">
        <TweakSelect
          label="Font pair"
          value={t.fontPair}
          onChange={(v) => setTweak("fontPair", v)}
          options={Object.keys(FONT_PAIRS)}
        />
      </TweakSection>

      <TweakSection title="Layout">
        <TweakRadio
          label="Hero background"
          value={t.heroBg}
          onChange={(v) => setTweak("heroBg", v)}
          options={["Cream", "Ink", "Topo"]}
        />
        <TweakToggle
          label="Marquee ticker"
          value={t.ticker}
          onChange={(v) => setTweak("ticker", v)}
        />
      </TweakSection>
    </TweaksPanel>
  );
}

// Quick HSL-ish shade (works on hex)
function shade(hex, lightDelta) {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map(x => x + x).join("") : h;
  let r = parseInt(n.slice(0,2), 16),
      g = parseInt(n.slice(2,4), 16),
      b = parseInt(n.slice(4,6), 16);
  r = clamp(r + lightDelta * 2.55);
  g = clamp(g + lightDelta * 2.55);
  b = clamp(b + lightDelta * 2.55);
  return "#" + [r,g,b].map(x => Math.round(x).toString(16).padStart(2,"0")).join("");
}
function clamp(v) { return Math.max(0, Math.min(255, v)); }

const mount = document.createElement("div");
document.body.appendChild(mount);
createRoot(mount).render(<App />);
