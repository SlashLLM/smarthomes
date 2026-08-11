/* SmartHomes — interactive owner dashboard mock */
(function () {
  const root = document.getElementById("dash");
  if (!root) return;

  const props = [
    { id: "p1", name: "Marine Parade Bach", loc: "Mt Maunganui", beds: 3, occ: 87, mtd: 11240, rating: 4.95, ph: "ph--1" },
    { id: "p2", name: "Queenstown Sky Studio", loc: "Queenstown CBD", beds: 2, occ: 82, mtd: 9120, rating: 4.88, ph: "ph--2" },
    { id: "p3", name: "Hahei Family Bach", loc: "Coromandel", beds: 4, occ: 71, mtd: 7460, rating: 4.91, ph: "ph--3" },
    { id: "p4", name: "Ponsonby Villa", loc: "Auckland", beds: 3, occ: 79, mtd: 8990, rating: 4.86, ph: "ph--4" },
  ];

  const upcoming = [
    { d: "27", m: "MAY", who: "Hannah & David L.", note: "2 guests · 4 nights · Marine Parade", amt: 1430 },
    { d: "02", m: "JUN", who: "Sato family",       note: "4 guests · 7 nights · Queenstown Studio", amt: 2840 },
    { d: "08", m: "JUN", who: "Priya M.",          note: "2 guests · 3 nights · Ponsonby Villa", amt: 980 },
    { d: "14", m: "JUN", who: "The Mills",         note: "6 guests · 5 nights · Hahei Bach", amt: 2210 },
    { d: "20", m: "JUN", who: "Owner block",       note: "Personal use · Marine Parade", amt: 0, ghost: true },
  ];

  const reviews = [
    { who: "Hannah · UK",     stars: 5, text: "Faultless. The smart-lock check-in at midnight worked perfectly after our late flight, and the welcome basket made my partner cry (good cry)." },
    { who: "Marcus · AU",     stars: 5, text: "Best bach we've stayed in. Even the kayaks were stocked with sunscreen — the team thinks of everything." },
    { who: "Priya · Auckland",stars: 4, text: "Beautiful place, would absolutely come back. Only nitpick: heat pump remote was a bit fiddly." },
  ];

  // monthly revenue (12 months)
  const rev = [4.8, 5.2, 6.1, 7.3, 8.4, 9.6, 12.1, 11.8, 9.4, 7.9, 6.6, 8.8].map((v) => v * 1000);

  const SVG_STR = `<svg viewBox="0 0 100 100">
    <circle class="ring__bg" cx="50" cy="50" r="42" stroke-width="10" fill="none"/>
    <circle class="ring__fg" cx="50" cy="50" r="42" stroke-width="10" fill="none"
            stroke-dasharray="264" stroke-dashoffset="44" stroke-linecap="round"
            transform="rotate(-90 50 50)"/>
  </svg>`;

  function icon(p) {
    return {
      home:  '<path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-3v-7H8v7H5a2 2 0 0 1-2-2z"/>',
      cal:   '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
      list:  '<path d="M3 6h18M3 12h18M3 18h18"/>',
      cash:  '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
      key:   '<circle cx="9" cy="15" r="4"/><path d="M12 12l8-8M16 8l3 3"/>',
      bell:  '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 0 0 4 0"/>',
      tool:  '<path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 1 5.4-5.4z"/>',
      star:  '<path d="M12 3l3 6 6 .9-4.5 4.3 1 6.3L12 17.8 6.5 20.5l1-6.3L3 9.9 9 9z"/>',
      cog:   '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    }[p];
  }
  const I = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon(p)}</svg>`;

  let activeTab = "overview";

  function renderOverview() {
    const maxRev = Math.max(...rev);
    const months = ["Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May"];
    return `
    <div class="dash__h">
      <div>
        <h3>Welcome back, Pania.</h3>
        <p>Here's how your 4 properties performed in May 2026.</p>
      </div>
      <div class="dash__filter">
        <button class="on">30d</button><button>90d</button><button>YTD</button><button>All time</button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi"><span>Revenue · MTD</span><strong>$36,810</strong><em>+18.4%</em></div>
      <div class="kpi"><span>Net to owner</span><strong>$28,840</strong><em>+19.1%</em></div>
      <div class="kpi"><span>Avg occupancy</span><strong>79.8%</strong><em>+2.3pp</em></div>
      <div class="kpi"><span>Guest rating</span><strong>4.92★</strong><em>+0.04</em></div>
    </div>

    <div class="widget-row">
      <div class="widget widget--rev">
        <div class="widget__h">
          <h4>Revenue · last 12 months</h4>
          <a href="#">Download CSV →</a>
        </div>
        <div class="revenue-chart">
          ${rev.map((v, i) => `<div class="bar ${i===6?'peak':''}" style="height:${(v/maxRev)*100}%" data-m="${months[i]}"></div>`).join("")}
        </div>
      </div>
      <div class="widget">
        <div class="widget__h"><h4>Occupancy · 30d</h4><a href="#">Trends →</a></div>
        <div class="occ-ring">
          ${SVG_STR}
          <div>
            <div class="occ-ring__num">83%</div>
            <div class="occ-ring__sub">8.3pp above NZ avg.</div>
            <div class="occ-ring__sub">42 nights booked / 19 vacant</div>
          </div>
        </div>
      </div>
    </div>

    <div class="widget-row">
      <div class="widget">
        <div class="widget__h"><h4>Upcoming stays</h4><a href="#">Full calendar →</a></div>
        <div class="bookings">
          ${upcoming.map(b => `
            <div class="booking" style="${b.ghost?'opacity:.55;':''}">
              <div class="booking__date">${b.m}<strong>${b.d}</strong></div>
              <div class="booking__guest">${b.who}<span>${b.note}</span></div>
              <div class="booking__amt">${b.amt ? '$'+b.amt.toLocaleString('en-NZ') : '— blocked'}</div>
            </div>
          `).join("")}
        </div>
      </div>
      <div class="widget">
        <div class="widget__h"><h4>Recent reviews</h4><a href="#">All 184 →</a></div>
        <div class="reviews">
          ${reviews.map(r => `
            <div class="review">
              <div class="review__head"><strong>${r.who}</strong><span class="review__stars">${'★'.repeat(r.stars)}${'☆'.repeat(5-r.stars)}</span></div>
              <p>"${r.text}"</p>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
    `;
  }

  function renderProperties() {
    return `
    <div class="dash__h">
      <div>
        <h3>Your portfolio</h3>
        <p>4 active properties · 1 in onboarding</p>
      </div>
      <div class="dash__filter"><button class="on">All</button><button>Active</button><button>Onboarding</button></div>
    </div>
    <div class="prop-list">
      ${props.map(p => `
        <div class="prop">
          <div class="ph ${p.ph}"></div>
          <div>
            <h5>${p.name}</h5>
            <div class="prop__loc">${p.loc} · ${p.beds}BR</div>
          </div>
          <div class="prop__col"><span>Occupancy</span><strong>${p.occ}%</strong></div>
          <div class="prop__col"><span>Revenue MTD</span><strong>$${p.mtd.toLocaleString('en-NZ')}</strong></div>
          <div class="prop__col"><span>Rating</span><strong>${p.rating}★</strong></div>
          <div class="prop__col"><span>Status</span><strong style="color:var(--good)">● Live</strong></div>
        </div>
      `).join("")}
      <div class="prop" style="opacity:.7;border-style:dashed;">
        <div class="ph" style="background:var(--paper-2);"></div>
        <div>
          <h5>Kerikeri Cliffside (onboarding)</h5>
          <div class="prop__loc">Bay of Islands · 5BR</div>
        </div>
        <div class="prop__col"><span>Photo shoot</span><strong>Jun 4</strong></div>
        <div class="prop__col"><span>Go-live</span><strong>Jun 12</strong></div>
        <div class="prop__col"><span>Forecast/yr</span><strong>$142,000</strong></div>
        <div class="prop__col"><span>Status</span><strong style="color:var(--accent)">● Onboarding</strong></div>
      </div>
    </div>`;
  }

  function renderCalendar() {
    const days = Array.from({length: 35}, (_, i) => i + 1);
    return `
    <div class="dash__h">
      <div><h3>Calendar · June 2026</h3><p>Marine Parade Bach · click any date to block it from your portal</p></div>
      <div class="dash__filter"><button>← May</button><button class="on">Jun</button><button>Jul →</button></div>
    </div>
    <div class="widget">
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;font-family:var(--mono);font-size:11px;color:var(--muted);margin-bottom:8px;">
        ${['M','T','W','T','F','S','S'].map(d=>`<div style="text-align:center;padding:4px;">${d}</div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;">
        ${days.map((d,i) => {
          const booked = [3,4,5,6,7,8,9,14,15,16,21,22,23,24,25,26,27,28].includes(d);
          const blocked = [12,13].includes(d);
          const turnover = [10,17,20,29].includes(d);
          const bg = booked ? 'var(--ink)' : blocked ? 'var(--accent)' : turnover ? 'var(--paper-2)' : '#fff';
          const co = booked || blocked ? 'var(--paper)' : 'var(--ink)';
          const tag = booked ? 'BOOKED' : blocked ? 'YOU' : turnover ? 'CLEAN' : '';
          return `<div style="background:${bg};color:${co};aspect-ratio:1;border-radius:8px;padding:8px;display:flex;flex-direction:column;justify-content:space-between;border:1px solid var(--line);font-family:var(--mono);">
            <strong style="font-size:13px;">${d}</strong>
            <span style="font-size:9px;letter-spacing:.08em;opacity:.75;">${tag}</span>
          </div>`;
        }).join("")}
      </div>
      <div style="display:flex;gap:18px;margin-top:16px;font-family:var(--mono);font-size:11px;color:var(--muted);">
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--ink);border-radius:2px;vertical-align:middle;margin-right:6px;"></span>Booked · 18 nights</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--accent);border-radius:2px;vertical-align:middle;margin-right:6px;"></span>Owner block · 2 nights</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--paper-2);border-radius:2px;vertical-align:middle;margin-right:6px;"></span>Turnover clean · 4</span>
      </div>
    </div>`;
  }

  function renderPayouts() {
    const payouts = [
      ["05 May 2026", "April · all properties", "$24,820", "Westpac ••4421", "Paid"],
      ["05 Apr 2026", "March · all properties", "$21,140", "Westpac ••4421", "Paid"],
      ["05 Mar 2026", "February · all properties", "$18,990", "Westpac ••4421", "Paid"],
      ["05 Feb 2026", "January · peak season", "$31,460", "Westpac ••4421", "Paid"],
      ["05 Jan 2026", "December · peak season", "$28,210", "Westpac ••4421", "Paid"],
    ];
    return `
    <div class="dash__h">
      <div><h3>Payouts</h3><p>Direct deposit, 5th of every month, NZD.</p></div>
      <div class="dash__filter"><button class="on">2026</button><button>2025</button><button>2024</button></div>
    </div>
    <div class="kpi-grid">
      <div class="kpi"><span>Paid YTD</span><strong>$124,620</strong><em>+22%</em></div>
      <div class="kpi"><span>Next payout</span><strong>$28,840</strong><em>05 Jun</em></div>
      <div class="kpi"><span>Pending</span><strong>$7,990</strong><em>Stays in progress</em></div>
      <div class="kpi"><span>2026 forecast</span><strong>$402K</strong><em>+18%</em></div>
    </div>
    <div class="widget">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="text-align:left;color:var(--muted);font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.06em;">
            <th style="padding:10px 0;">Date</th><th>Period</th><th>Amount</th><th>Account</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${payouts.map(p => `<tr style="border-top:1px solid var(--line);">
            <td style="padding:14px 0;font-family:var(--mono);">${p[0]}</td>
            <td>${p[1]}</td>
            <td style="font-family:var(--mono);font-weight:500;">${p[2]}</td>
            <td style="font-family:var(--mono);color:var(--muted);">${p[3]}</td>
            <td><span style="background:rgba(47,123,79,.10);color:var(--good);padding:2px 8px;border-radius:999px;font-family:var(--mono);font-size:11px;">● ${p[4]}</span></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function renderTab(name) {
    if (name === "properties") return renderProperties();
    if (name === "calendar") return renderCalendar();
    if (name === "payouts") return renderPayouts();
    return renderOverview();
  }

  function paint() {
    root.innerHTML = `
      <div class="dash__chrome">
        <div class="dash__lights"><span></span><span></span><span></span></div>
        <div class="dash__url">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v10m0 0l-3-3m3 3l3-3M5 19h14"/></svg>
          portal.smarthomes.co.nz / properties
        </div>
        <div style="margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--muted);">SmartHomes Owner Portal · v4.2</div>
      </div>
      <div class="dash__app">
        <aside class="dash__side">
          <div class="dash__owner">
            <div class="avatar">PT</div>
            <div><strong>Pania H.</strong><span>4 properties · BoP</span></div>
          </div>
          ${tabBtn("overview","Overview","home")}
          ${tabBtn("properties","Properties","list")}
          ${tabBtn("calendar","Calendar","cal")}
          ${tabBtn("payouts","Payouts","cash")}
          <h6>Operations</h6>
          ${tabBtn("cleaning","Cleaning","key")}
          ${tabBtn("maintenance","Maintenance","tool")}
          ${tabBtn("reviews","Reviews","star")}
          <h6>Account</h6>
          ${tabBtn("alerts","Alerts","bell")}
          ${tabBtn("settings","Settings","cog")}
        </aside>
        <section class="dash__main">${renderTab(activeTab)}</section>
      </div>
    `;
    // wire tabs
    root.querySelectorAll(".dash__tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTab = btn.dataset.tab;
        paint();
        // scroll to top of dash for clarity
        root.querySelector(".dash__main").scrollTo({ top: 0, behavior: "auto" });
      });
    });
    // wire filter pills (just visual toggle within active tab)
    root.querySelectorAll(".dash__filter").forEach((g) => {
      g.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        g.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
      });
    });
  }

  function tabBtn(id, label, ic) {
    const real = ["overview","properties","calendar","payouts"].includes(id);
    return `<button class="dash__tab ${activeTab===id?'on':''}" data-tab="${id}">${I(ic)}${label}${real?'':'<span style="margin-left:auto;font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:.06em;">SOON</span>'}</button>`;
  }

  paint();
})();
