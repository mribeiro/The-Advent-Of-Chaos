#!/usr/bin/env node
// Builds the static site into dist/:
//   dist/index.html              current edition (chosen in the browser)
//   dist/<year>/index.html       archive page per edition
//   dist/data/editions.json      list of years
//   dist/data/<year>.json        all frozen days of a year, merged
import fs from "node:fs";
import path from "node:path";

const DIST = process.env.TAOC_DIST_DIR || "dist";
const SITE = "site";
const DATA = process.env.TAOC_DATA_DIR || "data";

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, "data"), { recursive: true });

for (const f of fs.readdirSync(SITE)) {
  if (f !== "index.html") fs.cpSync(path.join(SITE, f), path.join(DIST, f), { recursive: true });
}

const years = (fs.existsSync(DATA) ? fs.readdirSync(DATA) : [])
  .filter((y) => /^\d{4}$/.test(y))
  .sort();

// The current year always gets an edition, even before its first day is frozen.
const thisYear = String(new Date().getUTCFullYear());
if (!years.includes(thisYear)) years.push(thisYear);

for (const year of years) {
  const dir = path.join(DATA, year);
  const days = {};
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((f) => /^\d{2}\.json$/.test(f)).sort()) {
      const e = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      days[e.day] = e;
    }
  }
  fs.writeFileSync(path.join(DIST, "data", `${year}.json`), JSON.stringify({ year: Number(year), days }));
}
fs.writeFileSync(
  path.join(DIST, "data", "editions.json"),
  JSON.stringify({ years: years.map(Number), builtAt: new Date().toISOString() }),
);

const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
fs.writeFileSync(path.join(DIST, "index.html"), html.replaceAll("{{ROOT}}", "./").replaceAll("{{YEAR}}", ""));
for (const year of years) {
  fs.mkdirSync(path.join(DIST, year), { recursive: true });
  fs.writeFileSync(
    path.join(DIST, year, "index.html"),
    html.replaceAll("{{ROOT}}", "../").replaceAll("{{YEAR}}", year),
  );
}
fs.writeFileSync(path.join(DIST, ".nojekyll"), "");

console.log(`built ${years.length} edition(s): ${years.join(", ")}`);
