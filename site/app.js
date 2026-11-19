// The Advent of Chaos: client-side calendar. All dates are UTC.
const GRACE_HOURS = 12;
const DAY_MS = 86_400_000;
const ROOT = document.body.dataset.root || "./";
// "" = the current yearly edition (picked below), "2026" = an archive page, other = a hidden edition slug.
const PAGE_EDITION = document.body.dataset.edition || null;

// ?now=2026-12-05T10:00:00Z simulates another instant (handy for testing; it can't reveal anything that isn't frozen yet).
const nowOverride = (() => {
  const v = new URLSearchParams(location.search).get("now");
  const d = v ? new Date(v) : null;
  return d && !isNaN(d) ? d.getTime() - Date.now() : 0;
})();
const now = () => new Date(Date.now() + nowOverride);

// The edition being shown: { key, start (ms), boxes, title, hidden }. Box n covers UTC day start + (n-1).
let ed;
const boxStart = (n) => new Date(ed.start + (n - 1) * DAY_MS);
const boxCutoff = (n) => new Date(ed.start + n * DAY_MS + GRACE_HOURS * 3600_000);
const boxLabel = (n) => boxStart(n).getUTCDate(); // boxes show their calendar date
const boxDate = (n) => boxStart(n).toISOString().slice(0, 10);
const shortDate = (n) => boxStart(n).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const yearEditionMeta = (y) => ({ key: String(y), start: Date.UTC(y, 11, 1), boxes: 24, title: String(y), hidden: false });

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
let days = {};
let opened = new Set();

function currentEdition(years) {
  const t = now();
  const y = t.getUTCFullYear();
  if (t.getUTCMonth() === 11) return y;
  // Jan–Nov: show last December's edition if there is one, otherwise the upcoming one.
  return years.includes(y - 1) ? y - 1 : y;
}

function stateOf(n) {
  const e = days[n];
  if (e) return e.type; // "news" | "joke"
  return now() < boxStart(n) ? "locked" : "searching";
}

/** Index of the box whose day is running now (0 before the start, boxes+1 after the end). */
function currentBox() {
  const i = Math.floor((now().getTime() - ed.start) / DAY_MS) + 1;
  return Math.max(0, Math.min(ed.boxes + 1, i));
}

// Deterministic per-edition shuffle so the boxes are scattered like a real advent calendar.
// Box sizes depend on the slot (position), not the day (see style.css). Slot 3 is the big box
// at every screen size, and the last box (Dec 24 in yearly editions) always goes there.
const BIG_SLOT = 2; // zero-based
function layout(key, boxes) {
  // Yearly editions keep their original seed (the year); other editions hash their key.
  let seed = (/^\d{4}$/.test(key) ? Number(key) : [...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)) * 2654435761;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const order = Array.from({ length: boxes - 1 }, (_, i) => i + 1);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.splice(BIG_SLOT, 0, boxes);
  return order;
}

// ---------- rendering ----------
const BADGE = { locked: "locked", searching: "scanning…", news: "incident", joke: "quiet day" };

function render() {
  const cal = $("#calendar");
  cal.className = `calendar n${ed.boxes}`;
  const order = layout(ed.key, ed.boxes);
  const today = currentBox();
  cal.replaceChildren(
    ...order.map((n) => {
      const s = stateOf(n);
      const e = days[n];
      const cls = [
        "box", s,
        n === today && "today",
        (s === "news" || s === "joke") && (opened.has(n) ? "opened" : "unopened"),
      ].filter(Boolean).join(" ");
      const peek = s === "news" ? e.news.headline : s === "joke" ? e.joke.setup : null;
      return el(
        "button",
        { class: cls, type: "button", "aria-label": `${shortDate(n)}: ${BADGE[s]}`, onclick: (ev) => openDay(n, ev.currentTarget) },
        s === "searching" ? el("span", { class: "scan" }) : null,
        el("span", { class: "num" }, boxLabel(n)),
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
  const c = currentBox();
  const start = boxStart(1);
  const end = boxCutoff(ed.boxes);
  const prefix = ed.hidden ? `🧪 <strong>${ed.title}</strong> · ` : "";
  let html;
  if (c === 0) {
    html = `The chaos begins in <strong>${fmtDuration(start - t)}</strong>. Patch your chimneys.`;
  } else if (c < ed.boxes) {
    html = `Box ${boxLabel(c + 1)} unlocks in <strong>${fmtDuration(boxStart(c + 1) - t)}</strong>.`;
  } else if (c === ed.boxes) {
    html = `Last box! The elves keep scanning until ${shortDate(ed.boxes + 1)}, 12:00 UTC.`;
  } else if (t < end) {
    html = `The elves are wrapping up the final box. Back in <strong>${fmtDuration(end - t)}</strong>.`;
  } else if (ed.hidden) {
    html = `That's a wrap for the ${ed.title.toLowerCase()}.`;
  } else {
    const realYear = t.getUTCFullYear();
    const nextStart = Date.UTC(t.getUTCMonth() === 11 ? realYear + 1 : realYear, 11, 1);
    html = ed.key !== String(currentEdition(editions))
      ? `Archive: the <strong>${ed.title}</strong> edition.`
      : `That's a wrap for ${ed.title}. The next round of chaos starts in <strong>${fmtDuration(nextStart - t)}</strong>.`;
  }
  b.hidden = false;
  b.innerHTML = prefix + html; // only static strings, numbers and our own edition title, never feed data
}

function renderArchive() {
  const nav = $("#archive");
  if (ed.hidden || editions.length < 2) return nav.replaceChildren();
  nav.replaceChildren(
    el("span", {}, "Editions:"),
    ...editions.map((y) =>
      el("a", { href: `${ROOT}${y}/`, "aria-current": String(y) === ed.key ? "page" : false }, y),
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

function dateLabel(n) {
  return boxStart(n).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

let terminalTimer;
function openDay(day, btn) {
  const s = stateOf(day);
  if (s === "locked") {
    btn.classList.remove("shake");
    void btn.offsetWidth;
    btn.classList.add("shake");
    toast(`ACCESS DENIED: box ${boxLabel(day)} unlocks ${shortDate(day)}, 00:00 UTC. No peeking, hacker.`);
    return;
  }
  const body = $("#modal-body");
  const e = days[day];
  clearInterval(terminalTimer);

  if (s === "news") {
    const n = e.news;
    body.replaceChildren(
      el("div", { class: "m-date" }, dateLabel(day)),
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
      el("div", { class: "m-date" }, dateLabel(day)),
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
      `$ ./elf-scan --date ${boxDate(day)} --tz UTC`,
      "[*] subscribing to 11 security feeds…",
      "[*] grepping for breaches, ransomware, 0-days…",
      "[*] interrogating the reindeer…",
      "[*] checking the naughty list for new entries…",
      "[~] nothing frozen yet. The elves re-scan every couple of hours.",
      `[i] if the day stays quiet until ${boxCutoff(day).toISOString().slice(0, 16).replace("T", " ")} UTC, you get a nerd joke.`,
    ];
    let i = 0;
    term.textContent = "";
    terminalTimer = setInterval(() => {
      if (i >= lines.length) return clearInterval(terminalTimer);
      term.textContent += (i ? "\n" : "") + lines[i++];
    }, 380);
    body.replaceChildren(
      el("div", { class: "m-date" }, dateLabel(day)),
      el("h2", { class: "m-title" }, "The elves are scanning the logs…"),
      term,
    );
  }

  if (s === "news" || s === "joke") {
    opened.add(day);
    store.set(`taoc-opened-${ed.key}`, [...opened]);
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
  const data = await getJSON(`data/${ed.key}.json`);
  days = data.days || {};
  if (data.start) ed = { key: ed.key, start: Date.parse(`${data.start}T00:00:00Z`), boxes: data.boxes, title: data.title, hidden: !!data.hidden };
}

async function boot() {
  try {
    editions = (await getJSON("data/editions.json")).years.sort((a, b) => a - b);
  } catch {
    editions = [now().getUTCFullYear()];
  }
  const key = PAGE_EDITION || String(currentEdition(editions));
  ed = /^\d{4}$/.test(key) ? yearEditionMeta(Number(key)) : { key, start: Date.now(), boxes: 24, title: "", hidden: true };
  try {
    await load();
  } catch (err) {
    console.error(err);
    days = {};
  }
  opened = new Set(store.get(`taoc-opened-${ed.key}`, []));
  document.querySelectorAll(".box-count").forEach((n) => (n.textContent = ed.boxes));
  if (ed.hidden) document.title = `The Advent of Chaos · ${ed.title}`;
  else if (PAGE_EDITION) document.title = `The Advent of Chaos ${ed.title}`;
  render();
  tickClock();
  setInterval(tickClock, 1000);
  snow();

  // While the edition is live, pick up newly frozen boxes without a reload.
  setInterval(async () => {
    const t = now().getTime();
    if (t < ed.start || t > boxCutoff(ed.boxes).getTime() + 3600_000) {
      // Still re-render at day boundaries so boxes unlock on time.
      return render();
    }
    try { await load(); } catch { /* keep current data */ }
    if (!$("#modal").open) render();
  }, 60_000 * 3);
}

boot();

// ---------- about ----------
const about = $("#about");
const openAbout = () => { if (!about.open) about.showModal(); };
document.querySelectorAll("[data-open-about]").forEach((b) => b.addEventListener("click", openAbout));
about.addEventListener("click", (e) => { if (e.target === e.currentTarget) about.close(); });
about.addEventListener("close", () => { if (location.hash === "#why") history.replaceState(null, "", location.pathname + location.search); });
if (location.hash === "#why") openAbout();
window.addEventListener("hashchange", () => { if (location.hash === "#why") openAbout(); });
