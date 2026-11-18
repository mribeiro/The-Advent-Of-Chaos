#!/usr/bin/env node
// Daily routine: looks for each open day's incident and freezes it into data/<year>/<DD>.json.
// A frozen file is never rewritten. Files are created with the exclusive 'wx' flag.
//
// Usage: node scripts/update.mjs [--now ISO] [--data-dir dir] [--fixture items.json] [--mock-ai] [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { FIRST_DAY, LAST_DAY, phase, isOnDay, isoDate, pad2, dayCutoff } from "./lib/time.mjs";
import { fetchAllFeeds } from "./lib/feeds.mjs";
import { pickIncident, writeJoke, hasApiKey, MODEL } from "./lib/curate.mjs";
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
  },
});

const now = args.now ? new Date(args.now) : new Date();
if (isNaN(now)) throw new Error(`invalid --now: ${args.now}`);
const year = now.getUTCFullYear();
const yearDir = path.join(args["data-dir"], String(year));
const dayFile = (day) => path.join(yearDir, `${pad2(day)}.json`);

const log = (...a) => console.log(`[${now.toISOString()}]`, ...a);

function loadFrozen() {
  const out = {};
  for (let d = FIRST_DAY; d <= LAST_DAY; d++) {
    if (fs.existsSync(dayFile(d))) out[d] = JSON.parse(fs.readFileSync(dayFile(d), "utf8"));
  }
  return out;
}

function freeze(day, entry) {
  if (args["dry-run"]) {
    log(`(dry-run) would freeze day ${day}:`, JSON.stringify(entry, null, 2));
    return;
  }
  fs.mkdirSync(yearDir, { recursive: true });
  // 'wx' fails if the file already exists, so a frozen day can never be overwritten.
  fs.writeFileSync(dayFile(day), JSON.stringify(entry, null, 2) + "\n", { flag: "wx" });
  log(`froze day ${day} as ${entry.type}`);
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

function poolJoke(previousJokes) {
  const used = new Set(previousJokes.map((j) => j.setup));
  const fresh = JOKE_POOL.filter((j) => !used.has(j.setup));
  const list = fresh.length ? fresh : JOKE_POOL;
  return list[Math.floor(Math.random() * list.length)];
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
  const frozen = loadFrozen();
  const openDays = [];
  for (let d = FIRST_DAY; d <= LAST_DAY; d++) {
    const p = phase(year, d, now);
    if (p !== "locked" && !frozen[d]) openDays.push({ day: d, phase: p });
  }
  if (!openDays.length) {
    log(`nothing to do for ${year} (${Object.keys(frozen).length} days frozen)`);
    return;
  }
  log(`open days: ${openDays.map((o) => `${o.day}(${o.phase})`).join(", ")}`);

  const useAi = !args["mock-ai"] && hasApiKey();
  if (!useAi && !args["mock-ai"]) log("WARNING: no ANTHROPIC_API_KEY. News can't be curated; closed days get pool jokes.");
  const pick = args["mock-ai"] ? mockPick : useAi ? pickIncident : null;

  const items = await loadItems();
  log(`${items.length} feed items loaded`);

  const usedUrls = new Set();
  const usedHeadlines = [];
  const previousJokes = [];
  for (const e of Object.values(frozen)) {
    if (e.type === "news") {
      usedHeadlines.push(e.news.headline);
      e.news.sources.forEach((s) => usedUrls.add(s.url));
    } else if (e.type === "joke") previousJokes.push(e.joke);
  }

  let failures = 0;
  for (const { day, phase: ph } of openDays) {
    const date = isoDate(year, day);
    const candidates = items
      // Ignore future-dated items (bad feed timestamps, or the future in a simulation).
      .filter((it) => isOnDay(it.published, year, day) && it.published <= now && !usedUrls.has(it.url))
      .sort((a, b) => b.published - a.published)
      .slice(0, MAX_CANDIDATES);
    log(`day ${day} [${ph}]: ${candidates.length} candidates`);

    let pickResult = null;
    let curationError = false;
    if (candidates.length && pick) {
      try {
        pickResult = await pick({ date, candidates, used: usedHeadlines });
        log(
          `day ${day}: ` +
            (pickResult.found
              ? `picked "${pickResult.headline}" notability=${pickResult.notability} (needs ${THRESHOLD[ph]})`
              : "no real incident") +
            ` | ${pickResult.reasoning}`,
        );
      } catch (err) {
        failures++;
        curationError = true;
        console.error(`day ${day}: curation failed: ${err.message}`);
      }
    }

    if (pickResult?.found && pickResult.notability >= THRESHOLD[ph]) {
      const { found, reasoning, ...news } = pickResult;
      freeze(day, {
        day,
        date,
        type: "news",
        frozenAt: now.toISOString(),
        model: args["mock-ai"] ? "mock" : MODEL,
        news,
      });
      usedHeadlines.push(news.headline);
      news.sources.forEach((s) => usedUrls.add(s.url));
      continue;
    }

    // If the API failed, give it up to 24h past the cutoff before settling for a joke.
    if (ph === "closed" && curationError && now - dayCutoff(year, day) < 24 * 3600_000) {
      log(`day ${day}: closed, but curation failed. Retrying on the next run before falling back to a joke`);
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
          console.error(`day ${day}: joke generation failed, using pool: ${err.message}`);
        }
      }
      joke ??= poolJoke(previousJokes);
      freeze(day, { day, date, type: "joke", frozenAt: now.toISOString(), model: source, joke });
      previousJokes.push(joke);
    }
  }
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
