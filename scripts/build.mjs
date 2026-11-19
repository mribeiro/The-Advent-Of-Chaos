#!/usr/bin/env node
// Builds the static site into dist/:
//   dist/index.html              current yearly edition (chosen in the browser)
//   dist/<year>/index.html       archive page per yearly edition
//   dist/<slug>/index.html       hidden extra editions (only when their secret slug env var is set)
//   dist/data/editions.json      list of PUBLIC years only
//   dist/data/<key>.json         an edition's metadata + all its frozen boxes
import fs from "node:fs";
import path from "node:path";
import { EXTRA_EDITIONS, yearEdition } from "./lib/editions.mjs";

const DIST = process.env.TAOC_DIST_DIR || "dist";
const SITE = "site";
const DATA = process.env.TAOC_DATA_DIR || "data";

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, "data"), { recursive: true });

for (const f of fs.readdirSync(SITE)) {
  if (f !== "index.html") fs.cpSync(path.join(SITE, f), path.join(DIST, f), { recursive: true });
}

function loadBoxes(id) {
  const dir = path.join(DATA, id);
  const boxes = {};
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((f) => /^\d{2}\.json$/.test(f)).sort()) {
      const e = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      boxes[e.day] = e;
    }
  }
  return boxes;
}

function writeEdition(key, ed) {
  const meta = { key, start: ed.start, boxes: ed.boxes, title: ed.title, hidden: ed.hidden };
  fs.writeFileSync(path.join(DIST, "data", `${key}.json`), JSON.stringify({ ...meta, days: loadBoxes(ed.id) }));
}

// Cloudflare Web Analytics site token (public). Optional: without it, no analytics.
const cfToken = (process.env.CF_BEACON_TOKEN || "").trim();
if (cfToken && !/^[a-f0-9]{32}$/i.test(cfToken)) throw new Error("CF_BEACON_TOKEN must be a 32-char hex token");
const template = fs.readFileSync(path.join(SITE, "index.html"), "utf8").replaceAll("{{CF_TOKEN}}", cfToken);
const page = (root, edition, robots = "index, follow") =>
  template.replaceAll("{{ROOT}}", root).replaceAll("{{EDITION}}", edition).replaceAll("{{ROBOTS}}", robots);

// Yearly editions.
const years = (fs.existsSync(DATA) ? fs.readdirSync(DATA) : []).filter((y) => /^\d{4}$/.test(y)).sort();
// The current year always gets an edition, even before its first box is frozen.
const thisYear = String(new Date().getUTCFullYear());
if (!years.includes(thisYear)) years.push(thisYear);

for (const year of years) writeEdition(year, yearEdition(Number(year)));
fs.writeFileSync(
  path.join(DIST, "data", "editions.json"),
  JSON.stringify({ years: years.map(Number), builtAt: new Date().toISOString() }),
);
fs.writeFileSync(path.join(DIST, "index.html"), page("./", ""));
for (const year of years) {
  fs.mkdirSync(path.join(DIST, year), { recursive: true });
  fs.writeFileSync(path.join(DIST, year, "index.html"), page("../", year));
}

// Hidden extra editions: published under a secret slug, never listed, never indexed.
const built = [...years];
for (const ed of EXTRA_EDITIONS) {
  const slug = (process.env[ed.slugEnv] || "").trim();
  if (!slug) {
    console.log(`skipping hidden edition "${ed.id}" (${ed.slugEnv} not set)`);
    continue;
  }
  if (!/^[a-z0-9-]{6,64}$/.test(slug) || /^\d{4}$/.test(slug)) throw new Error(`${ed.slugEnv} must be 6-64 chars of [a-z0-9-]`);
  writeEdition(slug, ed);
  fs.mkdirSync(path.join(DIST, slug), { recursive: true });
  fs.writeFileSync(path.join(DIST, slug, "index.html"), page("../", slug, "noindex, nofollow, noarchive"));
  built.push(`${ed.id} (hidden)`);
}

fs.writeFileSync(path.join(DIST, ".nojekyll"), "");
console.log(`built ${built.length} edition(s): ${built.join(", ")}`);
