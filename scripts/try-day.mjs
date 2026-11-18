#!/usr/bin/env node
// Preview what Claude would freeze for any real past date, without writing anything.
//   ANTHROPIC_API_KEY=... node scripts/try-day.mjs 2026-11-17 [--joke]
import { fetchAllFeeds } from "./lib/feeds.mjs";
import { pickIncident, writeJoke, MODEL } from "./lib/curate.mjs";

const [date, flag] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  console.error("usage: node scripts/try-day.mjs YYYY-MM-DD [--joke]");
  process.exit(2);
}
console.log(`model: ${MODEL}`);
if (flag === "--joke") {
  console.log(await writeJoke({ previousJokes: [] }));
  process.exit(0);
}
const start = new Date(`${date}T00:00:00Z`);
const end = new Date(start.getTime() + 86400_000);
const candidates = (await fetchAllFeeds())
  .filter((it) => it.published >= start && it.published < end)
  .sort((a, b) => b.published - a.published)
  .slice(0, 60);
console.log(`${candidates.length} candidates on ${date}`);
console.log(JSON.stringify(await pickIncident({ date, candidates, used: [] }), null, 2));
