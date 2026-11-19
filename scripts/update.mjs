#!/usr/bin/env node
// Routine: for every active edition, looks for each open box's incident and freezes it into
// data/<edition>/<NN>.json. A frozen file is never rewritten. Files are created with the 'wx' flag.
//
// Usage: node scripts/update.mjs [--now ISO] [--data-dir dir] [--fixture items.json] [--mock-ai] [--dry-run]
//                                [--only id,id]   (restrict to some editions, e.g. for tests)
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { editionsAt, phase, isOnBox, boxDate, boxStart, boxCutoff, pad2, EDITION_DIR_RE } from "./lib/editions.mjs";
import { fetchAllFeeds } from "./lib/feeds.mjs";
import { pickIncident, writeJoke, rejectJoke, hasApiKey, MODEL } from "./lib/curate.mjs";
import { JOKE_POOL } from "./lib/joke-pool.mjs";

/** Minimum notability needed to freeze news, per phase. */
const THRESHOLD = { live: 7, grace: 3, closed: 3 };
const MAX_CANDIDATES = 60;

const { values: args } = parseArgs({
  options: {
    now: { type: "string" },
    "data-dir": { type: "string", default: "data" },
    fixture: { type: "string" },
    "mock-ai": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    only: { type: "string" },
  },
});

const now = args.now ? new Date(args.now) : new Date();
if (isNaN(now)) throw new Error(`invalid --now: ${args.now}`);
const only = args.only ? new Set(args.only.split(",")) : null;
const editions = editionsAt(now).filter((ed) => !only || only.has(ed.id));
const edDir = (ed) => path.join(args["data-dir"], ed.id);
const boxFile = (ed, n) => path.join(edDir(ed), `${pad2(n)}.json`);

const log = (...a) => console.log(`[${now.toISOString()}]`, ...a);

function loadFrozen(ed) {
  const out = {};
  for (let n = 1; n <= ed.boxes; n++) {
    if (fs.existsSync(boxFile(ed, n))) out[n] = JSON.parse(fs.readFileSync(boxFile(ed, n), "utf8"));
  }
  return out;
}

function freeze(ed, n, entry) {
  if (args["dry-run"]) {
    log(`(dry-run) would freeze ${ed.id} box ${n}:`, JSON.stringify(entry, null, 2));
    return;
  }
  fs.mkdirSync(edDir(ed), { recursive: true });
  // 'wx' fails if the file already exists, so a frozen box can never be overwritten.
  fs.writeFileSync(boxFile(ed, n), JSON.stringify(entry, null, 2) + "\n", { flag: "wx" });
  log(`froze ${ed.id} box ${n} (${entry.date}) as ${entry.type}`);
}

// --- offline stand-ins, for tests and simulations --------------------------------
const INCIDENT_RE = /breach|ransomware|hack|attack|leak|stolen|exploit|compromis|ddos|malware|zero-day/i;
async function mockPick({ candidates }) {
  const i = candidates.findIndex((c) => INCIDENT_RE.test(c.title));
  if (i < 0) return { found: false, reasoning: "mock: no incident keyword" };
  const c = candidates[i];
  return {
    found: true,
    notability: 8,
    headline: c.title,
    summary: `(mock) ${c.excerpt || c.title}`,
    chaosTwist: "(mock) The elves are not amused.",
    naughtyLevel: 3,
    category: "other",
    reasoning: "mock: first keyword match",
    sources: [{ title: c.title, url: c.url, outlet: c.source }],
  };
}

/** A pool joke never used in any edition, or null when the pool is exhausted. */
function poolJoke(previousJokes) {
  const fresh = JOKE_POOL.filter((j) => !rejectJoke(j, previousJokes));
  return fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : null;
}

/** Jokes from every edition (all years and extras), so a joke is never reused. */
function allPreviousJokes() {
  const root = args["data-dir"];
  const out = [];
  for (const y of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    if (!EDITION_DIR_RE.test(y) || !fs.statSync(path.join(root, y)).isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(root, y))) {
      if (!/^\d{2}\.json$/.test(f)) continue;
      const e = JSON.parse(fs.readFileSync(path.join(root, y, f), "utf8"));
      if (e.type === "joke") out.push(e.joke);
    }
  }
  return out;
}
// -----------------------------------------------------------------------------

async function loadItems() {
  if (args.fixture) {
    return JSON.parse(fs.readFileSync(args.fixture, "utf8")).map((it) => ({
      ...it,
      published: new Date(it.published),
    }));
  }
  return fetchAllFeeds();
}

async function main() {
  // Collect the open boxes of every edition.
  const work = [];
  for (const ed of editions) {
    if (now < boxStart(ed, 1)) continue;
    const frozen = loadFrozen(ed);
    const open = [];
    for (let n = 1; n <= ed.boxes; n++) {
      const p = phase(ed, n, now);
      if (p !== "locked" && !frozen[n]) open.push({ n, phase: p });
    }
    if (open.length) work.push({ ed, frozen, open });
    else log(`${ed.id}: nothing to do (${Object.keys(frozen).length}/${ed.boxes} boxes frozen)`);
  }
  if (!work.length) return;

  const useAi = !args["mock-ai"] && hasApiKey();
  if (!useAi && !args["mock-ai"]) log("WARNING: no ANTHROPIC_API_KEY. News can't be curated; closed boxes get pool jokes.");
  const pick = args["mock-ai"] ? mockPick : useAi ? pickIncident : null;

  const items = await loadItems();
  log(`${items.length} feed items loaded`);

  // Jokes are unique across ALL editions; incidents are unique within an edition.
  const previousJokes = allPreviousJokes();
  let failures = 0;

  for (const { ed, frozen, open } of work) {
    log(`${ed.id}: open boxes ${open.map((o) => `${o.n}(${o.phase})`).join(", ")}`);
    const usedUrls = new Set();
    const usedHeadlines = [];
    for (const e of Object.values(frozen)) {
      if (e.type === "news") {
        usedHeadlines.push(e.news.headline);
        e.news.sources.forEach((s) => usedUrls.add(s.url));
      }
    }

    for (const { n, phase: ph } of open) {
      const date = boxDate(ed, n);
      const tag = `${ed.id} box ${n} (${date}) [${ph}]`;
      const candidates = items
        // Ignore future-dated items (bad feed timestamps, or the future in a simulation).
        .filter((it) => isOnBox(it.published, ed, n) && it.published <= now && !usedUrls.has(it.url))
        .sort((a, b) => b.published - a.published)
        .slice(0, MAX_CANDIDATES);
      log(`${tag}: ${candidates.length} candidates`);

      let pickResult = null;
      let curationError = false;
      if (candidates.length && pick) {
        try {
          pickResult = await pick({ date, candidates, used: usedHeadlines });
          log(
            `${tag}: ` +
              (pickResult.found
                ? `picked "${pickResult.headline}" notability=${pickResult.notability} (needs ${THRESHOLD[ph]})`
                : "no real incident") +
              ` | ${pickResult.reasoning}`,
          );
        } catch (err) {
          failures++;
          curationError = true;
          console.error(`${tag}: curation failed: ${err.message}`);
        }
      }

      if (pickResult?.found && pickResult.notability >= THRESHOLD[ph]) {
        const { found, reasoning, ...news } = pickResult;
        freeze(ed, n, { day: n, date, type: "news", frozenAt: now.toISOString(), model: args["mock-ai"] ? "mock" : MODEL, news });
        usedHeadlines.push(news.headline);
        news.sources.forEach((s) => usedUrls.add(s.url));
        continue;
      }

      // If the API failed, give it up to 24h past the cutoff before settling for a joke.
      if (ph === "closed" && curationError && now - boxCutoff(ed, n) < 24 * 3600_000) {
        log(`${tag}: closed, but curation failed. Retrying on the next run before falling back to a joke`);
        continue;
      }
      if (ph === "closed") {
        let joke;
        let source = "pool";
        if (useAi) {
          try {
            joke = await writeJoke({ previousJokes });
            source = MODEL;
          } catch (err) {
            failures++;
            console.error(`${tag}: joke generation failed, using pool: ${err.message}`);
          }
        }
        joke ??= poolJoke(previousJokes);
        if (!joke) {
          failures++;
          console.error(`${tag}: no fresh joke available (API failed and pool exhausted). Retrying on the next run`);
          continue;
        }
        freeze(ed, n, { day: n, date, type: "joke", frozenAt: now.toISOString(), model: source, joke });
        previousJokes.push(joke);
      }
    }
  }
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
