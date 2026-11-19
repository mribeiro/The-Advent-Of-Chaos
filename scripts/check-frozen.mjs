#!/usr/bin/env node
// Guards immutability: a day file under data/ may be added, but never modified, renamed or deleted.
// Also validates the shape of every day file.
//
//   node scripts/check-frozen.mjs            # working tree vs HEAD (used before committing)
//   node scripts/check-frozen.mjs <baseRef>  # <baseRef>..HEAD (used on push)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { EDITION_DIR_RE } from "./lib/editions.mjs";

const base = process.argv[2];
const git = (...a) => execFileSync("git", a, { encoding: "utf8" });

let diff = "";
if (base && !/^0+$/.test(base)) {
  diff = git("diff", "--name-status", "--no-renames", base, "HEAD", "--", "data");
} else if (!base) {
  diff = git("diff", "--name-status", "--no-renames", "HEAD", "--", "data");
}

const violations = diff
  .split("\n")
  .filter(Boolean)
  .map((l) => l.split("\t"))
  .filter(([status, file]) => status !== "A" && /^data\/[a-z0-9-]+\/\d{2}\.json$/.test(file));

let ok = true;
for (const [status, file] of violations) {
  console.error(`FROZEN DAY CHANGED: ${status} ${file}`);
  ok = false;
}

// Validate shape of all day files.
const isStr = (v) => typeof v === "string" && v.length > 0;
for (const year of fs.existsSync("data") ? fs.readdirSync("data") : []) {
  if (!EDITION_DIR_RE.test(year) || !fs.statSync(path.join("data", year)).isDirectory()) continue;
  for (const f of fs.readdirSync(path.join("data", year))) {
    const file = path.join("data", year, f);
    try {
      if (!/^\d{2}\.json$/.test(f)) throw new Error("unexpected file name");
      const e = JSON.parse(fs.readFileSync(file, "utf8"));
      if (e.day !== Number(f.slice(0, 2))) throw new Error("day mismatch");
      if (e.type === "news") {
        const n = e.news;
        if (!isStr(n?.headline) || !isStr(n?.summary) || !Array.isArray(n?.sources) || !n.sources.length)
          throw new Error("bad news entry");
        if (!n.sources.every((s) => /^https?:\/\//.test(s.url))) throw new Error("bad source url");
      } else if (e.type === "joke") {
        if (!isStr(e.joke?.setup) || !isStr(e.joke?.punchline)) throw new Error("bad joke entry");
      } else throw new Error(`unknown type ${e.type}`);
    } catch (err) {
      console.error(`INVALID: ${file}: ${err.message}`);
      ok = false;
    }
  }
}

if (!ok) process.exit(1);
console.log("frozen days intact");
