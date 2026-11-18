// The Advent of Chaos: client-side calendar. All dates are UTC.
const FIRST_DAY = 1;
const LAST_DAY = 24;
const GRACE_HOURS = 12;
const ROOT = document.body.dataset.root || "./";
const PAGE_YEAR = Number(document.body.dataset.year) || null;

// ?now=2026-12-05T10:00:00Z simulates another instant (handy for testing; it can't reveal anything that isn't frozen yet).
const nowOverride = (() => {
  const v = new URLSearchParams(location.search).get("now");
  const d = v ? new Date(v) : null;
  return d && !isNaN(d) ? d.getTime() - Date.now() : 0;
})();
const now = () => new Date(Date.now() + nowOverride);

const dayStart = (y, d) => new Date(Date.UTC(y, 11, d));
const dayCutoff = (y, d) => new Date(Date.UTC(y, 11, d + 1) + GRACE_HOURS * 3600_000);

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
  },
};

async function getJSON(path) {
  const res = await fetch(`${ROOT}${path}?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

// ---------- state ----------
let editions = [];
let year;
let days = {};
let opened = new Set();

function currentEdition(years) {
  const t = now();
  const y = t.getUTCFullYear();
  if (t.getUTCMonth() === 11) return y;
  // Jan–Nov: show last December's edition if there is one, otherwise the upcoming one.
  return years.includes(y - 1) ? y - 1 : y;
}

function stateOf(day) {
  const e = days[day];
  if (e) return e.type; // "news" | "joke"
  return now() < dayStart(year, day) ? "locked" : "searching";
}

// Deterministic per-year shuffle so the boxes are scattered like a real advent calendar.
function layout(y) {
  let seed = y * 2654435761;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const order = Array.from({ length: LAST_DAY }, (_, i) => i + 1);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const wide = new Set(order.filter((d) => d !== 24).slice(0, 4));
  return { order, wide };
}

// ---------- rendering ----------
const BADGE = { locked: "locked", searching: "scanning…", news: "incident", joke: "quiet day" };

function render() {
  const cal = $("#calendar");
  const { order, wide } = layout(year);
  const t = now();
  cal.replaceChildren(
    ...order.map((day) => {
      const s = stateOf(day);
      const e = days[day];
      const isToday = t.getUTCFullYear() === year && t.getUTCMonth() === 11 && t.getUTCDate() === day;
      const cls = [
        "box", s,
        wide.has(day) && "wide",
        day === 24 && "wide tall",
        isToday && "today",
        (s === "news" || s === "joke") && (opened.has(day) ? "opened" : "unopened"),
      ].filter(Boolean).join(" ");
      const peek = s === "news" ? e.news.headline : s === "joke" ? e.joke.setup : null;
      return el(
        "button",
        { class: cls, type: "button", "aria-label": `December ${day}: ${BADGE[s]}`, onclick: (ev) => openDay(day, ev.currentTarget) },
        s === "searching" ? el("span", { class: "scan" }) : null,
        el("span", { class: "num" }, day),
        peek ? el("span", { class: "peek" }, peek) : null,
        el("span", { class: "badge" }, s === "locked" ? "🔒 " + BADGE[s] : BADGE[s]),
      );
    }),
  );
  renderBanner();
  renderArchive();
}

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (d ? `${d}d ` : "") + `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
}

function renderBanner() {
  const b = $("#banner");
  const t = now();
  const start = dayStart(year, FIRST_DAY);
  const end = dayCutoff(year, LAST_DAY);
  const realYear = t.getUTCFullYear();
  let html = null;
  if (t < start) {
    html = `The chaos begins in <strong>${fmtDuration(start - t)}</strong>. Patch your chimneys.`;
  } else if (t < dayStart(year, LAST_DAY + 1)) {
    const next = dayStart(year, t.getUTCDate() + 1);
    html = t.getUTCDate() < LAST_DAY
      ? `Box ${t.getUTCDate() + 1} unlocks in <strong>${fmtDuration(next - t)}</strong>.`
      : `Last box! The elves keep scanning until Dec 25, 12:00 UTC.`;
  } else if (t < end) {
    html = `The elves are wrapping up the final box. Back in <strong>${fmtDuration(end - t)}</strong>.`;
  } else {
    const nextStart = dayStart(t.getUTCMonth() === 11 ? realYear + 1 : realYear, FIRST_DAY);
    html = year !== currentEdition(editions)
      ? `Archive: the <strong>${year}</strong> edition.`
      : `That's a wrap for ${year}. The next round of chaos starts in <strong>${fmtDuration(nextStart - t)}</strong>.`;
  }
  b.hidden = !html;
  if (html) b.innerHTML = html; // only static strings + numbers, never data
}

function renderArchive() {
  const nav = $("#archive");
  if (editions.length < 2) return nav.replaceChildren();
  nav.replaceChildren(
    el("span", {}, "Editions:"),
    ...editions.map((y) =>
      el("a", { href: `${ROOT}${y}/`, "aria-current": y === year ? "page" : false }, y),
    ),
  );
}

// ---------- modal ----------
const CATEGORY_LABEL = {
  breach: "Data breach",
  ransomware: "Ransomware",
  ddos: "DDoS",
  "exploited-vulnerability": "Exploited vuln",
  "supply-chain": "Supply chain",
  espionage: "Espionage",
  "scam-phishing": "Scam / phishing",
  outage: "Outage",
  other: "Chaos",
};

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
}

function dateLabel(day) {
  return dayStart(year, day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

let terminalTimer;
function openDay(day, btn) {
  const s = stateOf(day);
  if (s === "locked") {
    btn.classList.remove("shake");
    void btn.offsetWidth;
    btn.classList.add("shake");
    toast(`ACCESS DENIED: box ${day} unlocks Dec ${day}, 00:00 UTC. No peeking, hacker.`);
    return;
  }
  const body = $("#modal-body");
  const e = days[day];
  clearInterval(terminalTimer);

  if (s === "news") {
    const n = e.news;
    body.replaceChildren(
      el("div", { class: "m-date" }, `Day ${day} · ${dateLabel(day)}`),
      el("h2", { class: "m-title" }, n.headline),
      el("div", { class: "chips" },
        el("span", { class: "chip" }, CATEGORY_LABEL[n.category] ?? "Chaos"),
        el("span", { class: "naughty" }, "Naughty level ", el("b", {}, "😈".repeat(n.naughtyLevel) + "·".repeat(5 - n.naughtyLevel))),
      ),
      el("p", { class: "m-summary" }, n.summary),
      n.chaosTwist ? el("blockquote", { class: "twist" }, "🎄 ", n.chaosTwist) : null,
      el("div", { class: "sources" },
        el("h3", {}, "Read the original reporting"),
        el("ul", {}, ...n.sources.map((src) =>
          el("li", {}, el("a", { href: src.url, target: "_blank", rel: "noopener noreferrer" }, src.title), ` (${src.outlet})`),
        )),
      ),
      el("p", { class: "frozen" }, `❄ Frozen ${new Date(e.frozenAt).toISOString().replace("T", " ").slice(0, 16)} UTC · summary by AI, may contain elf errors`),
    );
  } else if (s === "joke") {
    const punch = el("p", { class: "punchline", hidden: true }, e.joke.punchline);
    const btnReveal = el("button", { class: "reveal", type: "button", onclick: () => { punch.hidden = false; btnReveal.remove(); } }, "> reveal punchline");
    body.replaceChildren(
      el("div", { class: "m-date" }, `Day ${day} · ${dateLabel(day)}`),
      el("h2", { class: "m-title" }, "All quiet on the North Pole front"),
      el("p", { class: "m-summary" }, "No notable breaches today. The elves got bored, so here's a joke instead:"),
      el("p", { class: "joke-setup" }, e.joke.setup),
      btnReveal,
      punch,
      el("p", { class: "frozen" }, `❄ Frozen ${new Date(e.frozenAt).toISOString().replace("T", " ").slice(0, 16)} UTC`),
    );
  } else {
    const term = el("div", { class: "terminal" });
    const lines = [
      `$ ./elf-scan --date ${year}-12-${String(day).padStart(2, "0")} --tz UTC`,
      "[*] subscribing to 11 security feeds…",
      "[*] grepping for breaches, ransomware, 0-days…",
      "[*] interrogating the reindeer…",
      "[*] checking the naughty list for new entries…",
      "[~] nothing frozen yet. The elves re-scan every couple of hours.",
      `[i] if the day stays quiet until ${dayCutoff(year, day).toISOString().slice(0, 16).replace("T", " ")} UTC, you get a nerd joke.`,
    ];
    let i = 0;
    term.textContent = "";
    terminalTimer = setInterval(() => {
      if (i >= lines.length) return clearInterval(terminalTimer);
      term.textContent += (i ? "\n" : "") + lines[i++];
    }, 380);
    body.replaceChildren(
      el("div", { class: "m-date" }, `Day ${day} · ${dateLabel(day)}`),
      el("h2", { class: "m-title" }, "The elves are scanning the logs…"),
      term,
    );
  }

  if (s === "news" || s === "joke") {
    opened.add(day);
    store.set(`taoc-opened-${year}`, [...opened]);
    btn.classList.replace("unopened", "opened");
  }
  const modal = $("#modal");
  modal.showModal();
  modal.addEventListener("close", () => clearInterval(terminalTimer), { once: true });
}

// Click on the backdrop closes the dialog.
$("#modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

// ---------- clock ----------
function tickClock() {
  $("#clock").textContent = `${now().toISOString().replace("T", " ").slice(0, 19)} UTC`;
  renderBanner();
}

// ---------- snow (binary + flakes) ----------
function snow() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = $("#snow");
  const ctx = c.getContext("2d");
  const glyphs = ["0", "1", "❄", "0", "1", "*"];
  let W, H, flakes;
  const reset = () => {
    W = c.width = innerWidth * devicePixelRatio;
    H = c.height = innerHeight * devicePixelRatio;
    const count = Math.min(140, Math.floor(innerWidth / 9));
    flakes = Array.from({ length: count }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      v: (0.4 + Math.random() * 1.2) * devicePixelRatio,
      s: (9 + Math.random() * 10) * devicePixelRatio,
      g: glyphs[Math.floor(Math.random() * glyphs.length)],
      drift: Math.random() * Math.PI * 2,
      red: Math.random() < 0.08,
    }));
  };
  reset();
  addEventListener("resize", reset);
  const frame = () => {
    ctx.clearRect(0, 0, W, H);
    for (const f of flakes) {
      f.y += f.v; f.drift += 0.01; f.x += Math.sin(f.drift) * 0.4;
      if (f.y > H + 20) { f.y = -20; f.x = Math.random() * W; }
      ctx.font = `${f.s}px JetBrains Mono, monospace`;
      ctx.fillStyle = f.red ? "rgba(255,59,78,0.55)" : "rgba(220,235,255,0.35)";
      ctx.fillText(f.g, f.x, f.y);
    }
    requestAnimationFrame(frame);
  };
  frame();
}

// ---------- boot ----------
async function load() {
  const data = await getJSON(`data/${year}.json`);
  days = data.days || {};
}

async function boot() {
  try {
    editions = (await getJSON("data/editions.json")).years.sort((a, b) => a - b);
  } catch {
    editions = [now().getUTCFullYear()];
  }
  year = PAGE_YEAR || currentEdition(editions);
  opened = new Set(store.get(`taoc-opened-${year}`, []));
  if (PAGE_YEAR) document.title = `The Advent of Chaos ${year}`;
  try {
    await load();
  } catch (err) {
    console.error(err);
    days = {};
  }
  render();
  tickClock();
  setInterval(tickClock, 1000);
  snow();

  // While the edition is live, pick up newly frozen days without a reload.
  setInterval(async () => {
    const t = now();
    if (t < dayStart(year, FIRST_DAY) || t.getTime() > dayCutoff(year, LAST_DAY).getTime() + 3600_000) {
      // Still re-render at day boundaries so boxes unlock on time.
      return render();
    }
    try { await load(); } catch { /* keep current data */ }
    if (!$("#modal").open) render();
  }, 60_000 * 3);
}

boot();
